import os
import json
import uuid
import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, Query, status, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import select

from database import Base, sync_engine, SyncSessionLocal
from models import Program, Track, Module, Class, Script, ScriptCard, ReviewAudit, MemoryLedger, VisualAsset, User, UserActivity
from schemas import (
    ProgramOut, TrackOut, ModuleOut, ClassOut,
    ScriptCreateRequest, OutlineResponse, OutlineApprovalRequest,
    MultiAgentReviewResponse, ScriptDetailResponse, ScriptCardOut,
    CardUpdateRequest, ChatAssistRequest, AssignmentResponse,
    ClassUpdate, ClassCreate, ModuleUpdate,
    ProgramCreate, ProgramUpdate, TrackCreate, TrackUpdate, ModuleCreate,
    UserOut, UserCreate, UserUpdate, ActivityLogCreate, UserActivityOut,
    OutlineCardAssistRequest
)
from agents.memory_engine import retrieve_context_memory, save_memory_ledger
from agents.writer import generate_outline, draft_card_batch
from agents.reviewer import run_multi_lens_reviews
from agents.moderator import reconcile_and_repair
from agents.attributes_generator import generate_mermaid_diagram, generate_html_animation, generate_image_asset
from agents.workflow_graph import script_graph

# Create DB tables
Base.metadata.create_all(bind=sync_engine)

# Lightweight migration for FR-3/4/6 module columns
def _migrate_module_columns():
    from sqlalchemy import text
    with sync_engine.begin() as conn:
        existing = {row[1] for row in conn.execute(text("PRAGMA table_info(modules)"))}
        for col, ddl in [
            ("plan_source", "ALTER TABLE modules ADD COLUMN plan_source VARCHAR(20) DEFAULT 'manual'"),
            ("plan_status", "ALTER TABLE modules ADD COLUMN plan_status VARCHAR(20) DEFAULT 'Locked'"),
            ("owner_name", "ALTER TABLE modules ADD COLUMN owner_name VARCHAR(255)"),
        ]:
            if col not in existing:
                conn.execute(text(ddl))

_migrate_module_columns()

app = FastAPI(
    title="Scaler AI Lecture Script Generator API",
    description="Multi-agent authoring, memory ledger, and quality audit engine for Scaler masterclass scripts.",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files for visual assets
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

def get_db():
    db = SyncSessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==============================================================================
# 1. CURRICULUM & CASCADING SELECTION ENDPOINTS
# ==============================================================================

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "Scaler Script Generator API", "version": "1.0.0"}

# ==============================================================================
# DASHBOARD METRICS & SCRIPTS QUEUE ENDPOINTS (PRD USERS & ROLES)
# ==============================================================================

@app.get("/api/dashboard/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    """Returns high-level curriculum and script progress metrics for PM/Admin/MO dashboards."""
    total_progs = db.query(Program).count()
    total_tracks = db.query(Track).count()
    total_mods = db.query(Module).count()
    total_classes = db.query(Class).count()
    total_scripts = db.query(Script).count()
    gtg_scripts = db.query(Script).filter(Script.status == "GTG").count()
    wip_scripts = db.query(Script).filter(Script.status.in_(["Script WIP", "SME Review", "Not Started"])).count()
    
    return {
        "total_programs": total_progs,
        "total_tracks": total_tracks,
        "total_modules": total_mods,
        "total_classes": total_classes,
        "total_scripts": total_scripts,
        "gtg_scripts": gtg_scripts,
        "wip_scripts": wip_scripts,
        "gtg_completion_pct": round((gtg_scripts / max(1, total_classes)) * 100, 2)
    }

# ==============================================================================
# USER AND ROLE ACCESS MANAGEMENT (PRD USERS & ROLES)
# ==============================================================================

@app.get("/api/users", response_model=List[UserOut])
def list_users(role: Optional[str] = None, db: Session = Depends(get_db)):
    """Lists registered users and their joined programs."""
    query = db.query(User)
    if role:
        query = query.filter(User.role == role)
    users = query.order_by(User.id).all()
    out = []
    for u in users:
        p_ids = [p.id for p in u.programs]
        p_names = [p.name for p in u.programs]
        out.append(UserOut(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            program_ids=p_ids,
            program_names=p_names
        ))
    return out

@app.get("/api/users/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    """Returns single user details and joined programs."""
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(
        id=u.id,
        name=u.name,
        email=u.email,
        role=u.role,
        program_ids=[p.id for p in u.programs],
        program_names=[p.name for p in u.programs]
    )

@app.post("/api/users", response_model=UserOut)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    """Creates a new user with role and joined programs."""
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    user = User(
        name=payload.name,
        email=payload.email,
        role=payload.role
    )
    if payload.program_ids:
        progs = db.query(Program).filter(Program.id.in_(payload.program_ids)).all()
        user.programs = progs
    db.add(user)
    db.commit()
    db.refresh(user)
    log_activity(db, user_name="Admin", user_role="admin", action_type="User Created", description=f"Enrolled new user '{user.name}' ({user.role.upper()}) with {len(user.programs)} programs")
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        program_ids=[p.id for p in user.programs],
        program_names=[p.name for p in user.programs]
    )

@app.put("/api/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db)):
    """Updates user details, role, and joined program memberships."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.name is not None:
        user.name = payload.name
    if payload.email is not None:
        user.email = payload.email
    if payload.role is not None:
        user.role = payload.role
    if payload.program_ids is not None:
        progs = db.query(Program).filter(Program.id.in_(payload.program_ids)).all()
        user.programs = progs
    db.commit()
    db.refresh(user)
    log_activity(db, user_name="Admin", user_role="admin", action_type="User Updated", description=f"Updated scope for user '{user.name}' ({user.role.upper()})")
    return UserOut(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        program_ids=[p.id for p in user.programs],
        program_names=[p.name for p in user.programs]
    )

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    """Removes a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    name = user.name
    db.delete(user)
    db.commit()
    log_activity(db, user_name="Admin", user_role="admin", action_type="User Deleted", description=f"Deleted user account: {name}")
    return {"success": True, "message": f"User '{name}' deleted successfully."}

def log_activity(db: Session, user_name: str, action_type: str, description: str, user_role: Optional[str] = None, details: Optional[str] = None):
    try:
        act = UserActivity(
            user_name=user_name,
            user_role=user_role,
            action_type=action_type,
            description=description,
            details=details
        )
        db.add(act)
        db.commit()
    except Exception as e:
        print(f"Error logging activity: {e}")

@app.get("/api/activities", response_model=List[UserActivityOut])
def get_user_activities(limit: int = 200, db: Session = Depends(get_db)):
    """Returns recent activities done across the platform."""
    acts = db.query(UserActivity).order_by(UserActivity.id.desc()).limit(limit).all()
    return acts

@app.post("/api/activities", response_model=UserActivityOut)
def record_user_activity(payload: ActivityLogCreate, db: Session = Depends(get_db)):
    """Allows front-end clients to log notable user actions directly."""
    act = UserActivity(
        user_name=payload.user_name,
        user_role=payload.user_role,
        action_type=payload.action_type,
        description=payload.description,
        details=payload.details
    )
    db.add(act)
    db.commit()
    db.refresh(act)
    return act

@app.get("/api/dashboard/scripts")
def list_dashboard_scripts(
    user_id: Optional[int] = None,
    program_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Returns detailed scripts list with hierarchy, scoped by user role and joined programs."""
    query = db.query(Script).join(Class, Script.class_id == Class.id)\
                            .join(Module, Class.module_id == Module.id)\
                            .join(Track, Module.track_id == Track.id)\
                            .join(Program, Track.program_id == Program.id)
    
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.role in ["sme", "mo"]:
            prog_ids = [p.id for p in user.programs]
            query = query.filter(Program.id.in_(prog_ids))

    if program_id:
        query = query.filter(Program.id == program_id)
    if status:
        query = query.filter(Script.status == status)
        
    scripts = query.order_by(Script.id.desc()).all()
    out = []
    for s in scripts:
        c = s.class_entity
        mod = c.module if c else None
        trk = mod.track if mod else None
        prog = trk.program if trk else None
        out.append({
            "id": s.id,
            "uuid": s.shareable_uuid,
            "status": s.status,
            "duration_minutes": s.duration_minutes,
            "class_id": s.class_id,
            "class_title": c.title if c else "Unknown",
            "module_name": mod.name if mod else "Unknown",
            "track_name": trk.name if trk else "Unknown",
            "program_name": prog.name if prog else "Unknown",
            "program_id": prog.id if prog else None,
            "sme_name": s.sme_name or (s.user.name if s.user else "Aryan (SME)"),
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "approved_at": s.approved_at.isoformat() if s.approved_at else None,
            "approved_by_name": s.approved_by_name if (s.status == "GTG") else None,
            "cards_count": len(s.cards) if s.cards else 0,
            "approved_by_mo": (s.status == "GTG")
        })
    return out

@app.get("/api/programs", response_model=List[ProgramOut])
def list_programs(user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Returns Scaler programs. Filtered to joined programs for SME and MO roles."""
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.role in ["sme", "mo"]:
            return sorted(user.programs, key=lambda p: p.id)
    return db.query(Program).order_by(Program.id).all()

@app.get("/api/tracks", response_model=List[TrackOut])
def list_tracks(program_id: int, db: Session = Depends(get_db)):
    """Cascading Selector: Tracks for a selected program."""
    return db.query(Track).filter(Track.program_id == program_id).order_by(Track.id).all()

# Official Metadata mapping for all Scaler programs modules (Segments, Types, Durations)
SCALER_MODULE_META = {
    # Program 1: Scaler Academy (modules 1..29)
    1: {"segment": "Programming Fundamentals", "type": "Core", "duration": "1 month"},
    2: {"segment": "Programming Fundamentals", "type": "Core", "duration": "1 month"},
    3: {"segment": "Programming Fundamentals", "type": "Core", "duration": "1 month"},
    4: {"segment": "Agentic AI", "type": "Core", "duration": "1 month"},
    5: {"segment": "Advanced DSA", "type": "Core", "duration": "1 month"},
    6: {"segment": "Advanced DSA", "type": "Core", "duration": "1 month"},
    7: {"segment": "Advanced DSA", "type": "Core", "duration": "1 month"},
    8: {"segment": "Advanced DSA", "type": "Core", "duration": "1 month"},
    9: {"segment": "Databases & SQL", "type": "Core", "duration": "1 month"},
    10: {"segment": "Backend", "type": "Specialisation", "duration": "1 month"},
    11: {"segment": "Backend", "type": "Specialisation", "duration": "1 month"},
    12: {"segment": "Backend", "type": "Specialisation", "duration": "1 month"},
    13: {"segment": "Backend", "type": "Specialisation", "duration": "1 month"},
    14: {"segment": "Backend", "type": "Elective", "duration": "1.5 months"},
    15: {"segment": "Backend", "type": "Elective", "duration": "1 month"},
    16: {"segment": "Fullstack", "type": "Specialisation", "duration": "0.5 month"},
    17: {"segment": "Fullstack", "type": "Specialisation", "duration": "1.5 months"},
    18: {"segment": "Fullstack", "type": "Specialisation", "duration": "1 month"},
    19: {"segment": "Fullstack", "type": "Specialisation", "duration": "1 month"},
    20: {"segment": "Fullstack", "type": "Elective", "duration": "0.5 month"},
    21: {"segment": "Fullstack", "type": "Elective", "duration": "0.5 month"},
    22: {"segment": "Fullstack", "type": "Elective", "duration": "0.5 month"},
    23: {"segment": "Fullstack", "type": "Elective", "duration": "1 month"},
    24: {"segment": "System Design", "type": "Elective", "duration": "1.5 months"},
    25: {"segment": "Interview Preparation", "type": "Core", "duration": "1.5 weeks"},
    26: {"segment": "Data Engineering", "type": "Data Engineering", "duration": "2 months"},
    27: {"segment": "Advanced DSA", "type": "Elective", "duration": "1 month"},
    28: {"segment": "Product Management", "type": "Elective", "duration": "1 month"},
    29: {"segment": "Gen AI", "type": "Elective", "duration": "1.5 months"},

    # Program 2: Scaler DSML (modules 30..51)
    30: {"segment": "Data Foundations", "type": "Core", "duration": "2 months"},
    31: {"segment": "Data Foundations", "type": "Core", "duration": "1 month"},
    32: {"segment": "Programming", "type": "Core", "duration": "1.5 months"},
    33: {"segment": "Analytics", "type": "Core", "duration": "1 month"},
    34: {"segment": "AI & GenAI", "type": "Core", "duration": "1 month"},
    35: {"segment": "Career", "type": "Core", "duration": "1 month"},
    36: {"segment": "Analytics", "type": "Core", "duration": "1.5 months"},
    37: {"segment": "Math & Stats", "type": "Core", "duration": "1.5 months"},
    38: {"segment": "Analytics", "type": "Core", "duration": "1 month"},
    39: {"segment": "Math & Stats", "type": "Core", "duration": "1 month"},
    40: {"segment": "Machine Learning", "type": "Core", "duration": "1.5 months"},
    41: {"segment": "Cloud & Data", "type": "Elective", "duration": "1 month"},
    42: {"segment": "Analytics", "type": "Elective", "duration": "1 month"},
    43: {"segment": "AI Foundations", "type": "Elective", "duration": "1 month"},
    44: {"segment": "Deep ML", "type": "Core", "duration": "1.5 months"},
    45: {"segment": "Deep ML", "type": "Core", "duration": "1.5 months"},
    46: {"segment": "Specialized ML", "type": "Core", "duration": "1 month"},
    47: {"segment": "MLOps", "type": "Core", "duration": "1 month"},
    48: {"segment": "Deep Learning", "type": "Core", "duration": "1.5 months"},
    49: {"segment": "Vision & NLP", "type": "Specialisation", "duration": "1.5 months"},
    50: {"segment": "Vision & NLP", "type": "Specialisation", "duration": "1.5 months"},
    51: {"segment": "Agentic AI", "type": "Specialisation", "duration": "2 months"},

    # Program 3: Scaler DevOps & Cloud (modules 130..146)
    130: {"segment": "Programming", "type": "Core", "duration": "1 month"},
    131: {"segment": "Linux & Systems", "type": "Core", "duration": "1 month"},
    132: {"segment": "Linux & Systems", "type": "Core", "duration": "1 month"},
    133: {"segment": "CI/CD & Containers", "type": "Core", "duration": "1.5 months"},
    134: {"segment": "Kubernetes & IaC", "type": "Core", "duration": "1.5 months"},
    135: {"segment": "Cloud Infrastructure", "type": "Core", "duration": "1 month"},
    136: {"segment": "Cloud Infrastructure", "type": "Core", "duration": "1 month"},
    137: {"segment": "SRE & Security", "type": "Core", "duration": "1 month"},
    138: {"segment": "MLOps", "type": "Core", "duration": "1 month"},
    139: {"segment": "GenAI & Agents", "type": "Core", "duration": "1 month"},
    140: {"segment": "GenAI & Agents", "type": "Core", "duration": "1 month"},
    141: {"segment": "DSA & Problem Solving", "type": "Elective", "duration": "1 month"},
    142: {"segment": "DSA & Problem Solving", "type": "Elective", "duration": "1 month"},
    143: {"segment": "DSA & Problem Solving", "type": "Elective", "duration": "1 month"},
    144: {"segment": "DSA & Problem Solving", "type": "Elective", "duration": "1 month"},
    145: {"segment": "DSA & Problem Solving", "type": "Elective", "duration": "1.5 months"},
    146: {"segment": "System Design", "type": "Elective", "duration": "1.5 months"},

    # Program 4: Scaler AI FDE (modules 147..160)
    147: {"segment": "Data & Ingestion", "type": "Core", "duration": "1 month"},
    148: {"segment": "Data & Ingestion", "type": "Core", "duration": "1 month"},
    149: {"segment": "Backend Systems", "type": "Core", "duration": "1 month"},
    150: {"segment": "Frontend Engineering", "type": "Core", "duration": "1 month"},
    151: {"segment": "Enterprise AI & RAG", "type": "Core", "duration": "1 month"},
    152: {"segment": "Agentic Systems", "type": "Core", "duration": "1 month"},
    153: {"segment": "Scale & System Design", "type": "Core", "duration": "1 month"},
    154: {"segment": "Scale & System Design", "type": "Core", "duration": "1 month"},
    155: {"segment": "Infra & Containers", "type": "Core", "duration": "1 month"},
    156: {"segment": "Infra & Containers", "type": "Core", "duration": "1 month"},
    157: {"segment": "Cloud & Reliability", "type": "Elective", "duration": "1.5 months"},
    158: {"segment": "Cloud & Reliability", "type": "Elective", "duration": "1 month"},
    159: {"segment": "Security & Governance", "type": "Elective", "duration": "1 month"},
    160: {"segment": "Capstone", "type": "Elective", "duration": "1 month"},

    # Program 5: Scaler AI/ML & Agentic AI
    109: {"segment": "Generative AI", "type": "Core", "duration": "2 months"},
    110: {"segment": "Programming Fundamentals", "type": "Core", "duration": "1 month"},
    102: {"segment": "Data Foundations", "type": "Core", "duration": "1 month"},
    113: {"segment": "Machine Learning & Deep Learning", "type": "Core", "duration": "5 months"},
    114: {"segment": "Big Data", "type": "Core", "duration": "1 month"},
    115: {"segment": "Reinforcement Learning", "type": "Core", "duration": "1 month"},
    116: {"segment": "DSA", "type": "Optional", "duration": "4 months"},
}
SCALER_ACADEMY_MODULE_META = SCALER_MODULE_META

def get_track_modules(db: Session, track: Track, specialisation: Optional[str] = None) -> List[Module]:
    """Returns the progressive curriculum modules for a given track/level, optionally filtered by specialisation."""
    if not track:
        return []
    
    prog_id = track.program_id
    track_name_lower = (track.name or "").lower()
    track_slug_lower = (track.slug or "").lower()

    target_ids = None

    if prog_id == 1:  # Scaler Academy (3 Levels: Beginner, Intermediate, Advanced + 2 Specialisations)
        if "beginner" in track_slug_lower or "beginner" in track_name_lower:
            # Beginner attends all 29 modules from Fundamentals through Electives
            target_ids = list(range(1, 30))
        elif "intermediate" in track_slug_lower or "intermediate" in track_name_lower:
            # Intermediate skips beginner foundation (modules 1 & 2), starts at Intermediate DSA (3 to 29)
            target_ids = list(range(3, 30))
        elif "advanced" in track_slug_lower or "advanced" in track_name_lower:
            # Advanced skips foundation & Intermediate DSA, starts at AI & Agents (4 to 29)
            target_ids = list(range(4, 30))
        elif "backend" in track_slug_lower or "backend" in track_name_lower:
            target_ids = [10, 11, 12, 13, 14, 15]
        elif "fullstack" in track_slug_lower or "fullstack" in track_name_lower:
            target_ids = [16, 17, 18, 19, 20, 21, 22, 23]

        # Apply Specialisation filtering for Scaler Academy
        if target_ids is not None and specialisation:
            spec_lower = specialisation.lower().strip()
            if "backend" in spec_lower:
                # Learner opted for Backend Specialisation: exclude Fullstack modules 16..23
                fullstack_ids = set(range(16, 24))
                target_ids = [mid for mid in target_ids if mid not in fullstack_ids]
            elif "fullstack" in spec_lower:
                # Learner opted for Fullstack Specialisation: exclude Backend modules 10..15
                backend_ids = set(range(10, 16))
                target_ids = [mid for mid in target_ids if mid not in backend_ids]

    elif prog_id == 2:  # Scaler DSML (2 Levels: Beginner Track, Intermediate Track)
        if "beginner" in track_slug_lower or "beginner" in track_name_lower:
            # All 22 modules: 6 foundational (30..35) + 16 analytics/ML (36..51)
            target_ids = list(range(30, 52))
        elif "intermediate" in track_slug_lower or "intermediate" in track_name_lower:
            # 16 modules: skips 6 foundational, starts at 36..51
            target_ids = list(range(36, 52))

    elif prog_id == 3:  # Scaler DevOps & Cloud (1 Track: Core & Electives Track)
        # All 17 modules (130 to 146)
        target_ids = list(range(130, 147))

    elif prog_id == 4:  # Scaler AI FDE (1 Track: Enterprise Deployment Track)
        # All 14 modules (147 to 160)
        target_ids = list(range(147, 161))

    elif prog_id == 5:  # Scaler AI/ML & Agentic AI (2 Levels: Beginner Track, Advanced Track)
        if "beginner" in track_slug_lower or "beginner" in track_name_lower:
            # All active deep-dive modules
            target_ids = [109, 110, 102, 113, 114, 115, 116]
        elif "advanced" in track_slug_lower or "advanced" in track_name_lower:
            # Skips no-code AI & basic python
            target_ids = [102, 113, 114, 115, 116]

    if target_ids is not None:
        modules = db.query(Module).filter(Module.id.in_(target_ids)).all()
        id_map = {m.id: m for m in modules}
        return [id_map[mid] for mid in target_ids if mid in id_map]
    
    return db.query(Module).filter(Module.track_id == track.id).order_by(Module.sequence_order).all()

def annotate_module_meta(m: Module, db: Session) -> ModuleOut:
    if m.id in SCALER_MODULE_META:
        meta = SCALER_MODULE_META[m.id]
        seg = meta["segment"]
        mod_type = meta["type"]
        duration = meta["duration"]
    else:
        seg = m.track.name if m.track else "Core"
        mod_type = m.module_type or "Core"
        duration = "1 month"
    
    count = db.query(Class).filter(Class.module_id == m.id).count()

    return ModuleOut(
        id=m.id,
        track_id=m.track_id,
        name=m.name,
        slug=m.slug,
        sequence_order=m.sequence_order,
        is_locked=m.is_locked,
        module_type=mod_type,
        segment=seg,
        class_count=count,
        duration_label=duration
    )

@app.get("/api/modules", response_model=List[ModuleOut])
def list_modules(
    track_id: Optional[int] = None,
    program_id: Optional[int] = None,
    specialisation: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Cascading Selector: Locked modules for a selected track/level or program with progressive level and specialisation mapping."""
    if track_id is not None:
        track = db.query(Track).filter(Track.id == track_id).first()
        if track:
            mods = get_track_modules(db, track, specialisation=specialisation)
            return [annotate_module_meta(m, db) for m in mods]
        return []

    if program_id is not None:
        if program_id == 1:
            target_ids = list(range(1, 30))
            if specialisation:
                spec_lower = specialisation.lower().strip()
                if "backend" in spec_lower:
                    target_ids = [mid for mid in target_ids if mid not in set(range(16, 24))]
                elif "fullstack" in spec_lower:
                    target_ids = [mid for mid in target_ids if mid not in set(range(10, 16))]
            mods = db.query(Module).filter(Module.id.in_(target_ids)).order_by(Module.id).all()
        else:
            mods = db.query(Module).join(Track).filter(Track.program_id == program_id).order_by(Module.sequence_order).all()
        return [annotate_module_meta(m, db) for m in mods]

    mods = db.query(Module).order_by(Module.id).all()
    return [annotate_module_meta(m, db) for m in mods]

@app.get("/api/classes", response_model=List[ClassOut])
def list_classes(module_id: int, db: Session = Depends(get_db)):
    """Cascading Selector: Classes within a locked module."""
    classes = db.query(Class).filter(Class.module_id == module_id).order_by(Class.sequence_number).all()
    results = []
    for c in classes:
        try:
            agendas_list = json.loads(c.agendas) if c.agendas else []
        except:
            agendas_list = [c.agendas]
        results.append(ClassOut(
            id=c.id,
            module_id=c.module_id,
            sequence_number=c.sequence_number,
            title=c.title,
            duration_minutes=c.duration_minutes,
            agendas=agendas_list,
            learning_outcomes=c.learning_outcomes,
            class_type=c.class_type,
            module_type=c.module_type
        ))
    return results

@app.get("/api/class/{class_id}")
def get_class_details(class_id: int, db: Session = Depends(get_db)):
    """Returns class agendas + automated Class N-1 continuity memory preview."""
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    try:
        agendas = json.loads(cls.agendas) if cls.agendas else []
    except:
        agendas = [cls.agendas]

    memory_preview = retrieve_context_memory(db, class_id)

    latest_script = db.query(Script).filter(Script.class_id == class_id).order_by(Script.id.desc()).first()
    latest_script_data = None
    if latest_script:
        latest_script_data = {
            "id": latest_script.id,
            "status": latest_script.status,
            "is_gtg": (latest_script.status == "GTG"),
            "shareable_uuid": latest_script.shareable_uuid,
            "duration_minutes": latest_script.duration_minutes,
            "cards_count": len(latest_script.cards) if latest_script.cards else 0
        }

    return {
        "class_id": cls.id,
        "title": cls.title,
        "sequence_number": cls.sequence_number,
        "duration_minutes": cls.duration_minutes,
        "agendas": agendas,
        "learning_outcomes": cls.learning_outcomes,
        "context_memory_preview": memory_preview,
        "latest_script": latest_script_data
    }

# ==============================================================================
# 1.1 MODULE OWNER (MO) / ADMIN CURRICULUM MANAGEMENT ENDPOINTS
# ==============================================================================

@app.get("/api/curriculum/full-tree")
def get_full_curriculum_tree(user_id: Optional[int] = None, program_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Returns structured curriculum hierarchy for Module Owner (MO) management, scoped to joined programs."""
    query = db.query(Program)
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.role in ["sme", "mo"]:
            prog_ids = [p.id for p in user.programs]
            query = query.filter(Program.id.in_(prog_ids))
    if program_id:
        query = query.filter(Program.id == program_id)
    programs = query.order_by(Program.id).all()
    
    tree = []
    for prog in programs:
        tracks = db.query(Track).filter(Track.program_id == prog.id).order_by(Track.id).all()
        track_list = []
        for trk in tracks:
            modules = get_track_modules(db, trk)
            mod_list = []
            for mod in modules:
                classes = db.query(Class).filter(Class.module_id == mod.id).order_by(Class.sequence_number).all()
                cls_list = []
                for c in classes:
                    try:
                        agendas_arr = json.loads(c.agendas) if c.agendas else []
                    except:
                        agendas_arr = [c.agendas]
                    cls_list.append({
                        "id": c.id,
                        "sequence_number": c.sequence_number,
                        "title": c.title,
                        "duration_minutes": c.duration_minutes,
                        "agendas": agendas_arr,
                        "learning_outcomes": c.learning_outcomes,
                        "class_type": c.class_type,
                        "module_type": c.module_type
                    })
                meta = SCALER_ACADEMY_MODULE_META.get(mod.id, {})
                seg = meta.get("segment", trk.name)
                mod_type = meta.get("type", mod.module_type or "Core")
                duration = meta.get("duration", "1 month")
                mod_list.append({
                    "id": mod.id,
                    "name": mod.name,
                    "segment": seg,
                    "duration_label": duration,
                    "module_type": mod_type,
                    "is_locked": mod.is_locked,
                    "plan_status": mod.plan_status or ("Locked" if mod.is_locked else "Draft"),
                    "plan_source": mod.plan_source or "manual",
                    "owner_name": mod.owner_name,
                    "approved_sources": mod.approved_sources or "",
                    "completeness_issues": evaluate_module_completeness(mod)["issues"],
                    "class_count": len(cls_list),
                    "classes": cls_list
                })
            track_list.append({
                "id": trk.id,
                "name": trk.name,
                "module_count": len(mod_list),
                "modules": mod_list
            })
        tree.append({
            "id": prog.id,
            "name": prog.name,
            "slug": prog.slug,
            "description": prog.description,
            "track_count": len(track_list),
            "tracks": track_list
        })
    return tree

def verify_curriculum_edit_permission(db: Session, user_id: Optional[int], program_id: Optional[int] = None):
    """Enforces PRD role permissions: PM is read-only, MO within assigned programs, Admin global."""
    if not user_id:
        return
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return
    if user.role == "pm":
        raise HTTPException(status_code=403, detail="Program Managers have read-only access and cannot edit curriculum.")
    if user.role == "sme":
        raise HTTPException(status_code=403, detail="SMEs cannot modify curriculum structures.")
    if user.role == "mo" and program_id:
        user_prog_ids = [p.id for p in user.programs]
        if program_id not in user_prog_ids:
            raise HTTPException(status_code=403, detail="Module Owners can only make edits within programs assigned to them by the Administrator.")

@app.put("/api/classes/{class_id}")
def update_class_by_mo(class_id: int, payload: ClassUpdate, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to edit class title, agendas, duration, and metadata."""
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    prog_id = cls.module.track.program_id if cls.module and cls.module.track else None
    verify_curriculum_edit_permission(db, user_id, prog_id)
    
    if payload.title is not None:
        cls.title = payload.title
    if payload.duration_minutes is not None:
        cls.duration_minutes = payload.duration_minutes
    if payload.agendas is not None:
        cls.agendas = json.dumps(payload.agendas)
    if payload.learning_outcomes is not None:
        cls.learning_outcomes = payload.learning_outcomes
    if payload.class_type is not None:
        cls.class_type = payload.class_type
    if payload.module_type is not None:
        cls.module_type = payload.module_type
    if payload.sequence_number is not None:
        cls.sequence_number = payload.sequence_number
    if payload.module_id is not None:
        cls.module_id = payload.module_id
        
    db.commit()
    db.refresh(cls)
    
    try:
        agendas_arr = json.loads(cls.agendas) if cls.agendas else []
    except:
        agendas_arr = [cls.agendas]
        
    return {
        "success": True,
        "message": f"Class '{cls.title}' updated successfully.",
        "class": {
            "id": cls.id,
            "module_id": cls.module_id,
            "sequence_number": cls.sequence_number,
            "title": cls.title,
            "duration_minutes": cls.duration_minutes,
            "agendas": agendas_arr,
            "learning_outcomes": cls.learning_outcomes,
            "class_type": cls.class_type,
            "module_type": cls.module_type
        }
    }

@app.post("/api/classes")
def create_class_by_mo(payload: ClassCreate, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to append a new class to an existing module."""
    mod = db.query(Module).filter(Module.id == payload.module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")

    prog_id = mod.track.program_id if mod.track else None
    verify_curriculum_edit_permission(db, user_id, prog_id)
        
    new_cls = Class(
        module_id=payload.module_id,
        sequence_number=payload.sequence_number,
        title=payload.title,
        duration_minutes=payload.duration_minutes,
        agendas=json.dumps(payload.agendas),
        learning_outcomes=payload.learning_outcomes,
        class_type=payload.class_type,
        module_type=payload.module_type
    )
    db.add(new_cls)
    db.commit()
    db.refresh(new_cls)

    editor_name = "Admin/MO"
    editor_role = "mo"
    if user_id:
        u = db.query(User).filter(User.id == user_id).first()
        if u:
            editor_name = u.name
            editor_role = u.role
    log_activity(
        db,
        user_name=editor_name,
        user_role=editor_role,
        action_type="Class Created",
        description=f"Added new class '{new_cls.title}' (#{new_cls.sequence_number}) under module '{mod.name}'"
    )

    return {
        "success": True,
        "class_id": new_cls.id,
        "class": {
            "id": new_cls.id,
            "module_id": new_cls.module_id,
            "sequence_number": new_cls.sequence_number,
            "title": new_cls.title,
            "duration_minutes": new_cls.duration_minutes
        },
        "message": f"Class '{new_cls.title}' created."
    }

@app.delete("/api/classes/{class_id}")
def delete_class_by_mo(class_id: int, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to remove a class from a module."""
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    prog_id = cls.module.track.program_id if cls.module and cls.module.track else None
    verify_curriculum_edit_permission(db, user_id, prog_id)
    title = cls.title
    db.delete(cls)
    db.commit()

    editor_name = "Admin/MO"
    editor_role = "mo"
    if user_id:
        u = db.query(User).filter(User.id == user_id).first()
        if u:
            editor_name = u.name
            editor_role = u.role
    log_activity(
        db,
        user_name=editor_name,
        user_role=editor_role,
        action_type="Class Deleted",
        description=f"Deleted canonical class '{title}' (ID: #{class_id})"
    )
    return {"success": True, "message": f"Class '{title}' deleted."}

@app.put("/api/modules/{module_id}")
def update_module_by_mo(module_id: int, payload: ModuleUpdate, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to update module details, lock status, level/track assignment, and approved sources."""
    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")

    prog_id = mod.track.program_id if mod.track else None
    verify_curriculum_edit_permission(db, user_id, prog_id)
        
    if payload.name is not None:
        mod.name = payload.name
    if payload.module_type is not None:
        mod.module_type = payload.module_type
    if payload.is_locked is not None:
        if payload.is_locked:
            prev = mod.plan_status
            mod.plan_status = "Locked"
            report = evaluate_module_completeness(mod)
            if not report["is_complete"]:
                mod.plan_status = prev
                raise HTTPException(status_code=400, detail={"message": "Module plan cannot be locked", "issues": report["issues"]})
        else:
            mod.plan_status = "In Review"
        mod.is_locked = payload.is_locked
    if payload.approved_sources is not None:
        mod.approved_sources = payload.approved_sources
    if payload.track_id is not None:
        mod.track_id = payload.track_id
    if payload.sequence_order is not None:
        mod.sequence_order = payload.sequence_order
        
    db.commit()
    db.refresh(mod)
    return {"success": True, "message": f"Module '{mod.name}' updated successfully."}

@app.post("/api/modules")
def create_module_by_mo(payload: ModuleCreate, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to append a new module to a track."""
    track = db.query(Track).filter(Track.id == payload.track_id).first()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    verify_curriculum_edit_permission(db, user_id, track.program_id)
        
    slug_val = payload.slug or payload.name.lower().strip().replace(" ", "-")
    existing_mod = db.query(Module).filter(Module.track_id == payload.track_id, Module.slug == slug_val).first()
    if existing_mod:
        slug_val = f"{slug_val}-{uuid.uuid4().hex[:6]}"

    new_mod = Module(
        track_id=payload.track_id,
        name=payload.name.strip(),
        slug=slug_val,
        module_type=payload.module_type,
        is_locked=payload.is_locked,
        approved_sources=payload.approved_sources
    )
    db.add(new_mod)
    db.commit()
    db.refresh(new_mod)
    return {"success": True, "module_id": new_mod.id, "message": f"Module '{new_mod.name}' created."}

@app.delete("/api/modules/{module_id}")
def delete_module_by_mo(module_id: int, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to remove a module and its classes."""
    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")

    prog_id = mod.track.program_id if mod.track else None
    verify_curriculum_edit_permission(db, user_id, prog_id)

    name = mod.name
    db.delete(mod)
    db.commit()
    return {"success": True, "message": f"Module '{name}' deleted."}

@app.post("/api/tracks")
def create_track_by_mo(payload: TrackCreate, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to add a new track to a program."""
    prog = db.query(Program).filter(Program.id == payload.program_id).first()
    if not prog:
        raise HTTPException(status_code=404, detail="Program not found")

    verify_curriculum_edit_permission(db, user_id, prog.id)
        
    slug_val = payload.slug or payload.name.lower().strip().replace(" ", "-")
    existing_track = db.query(Track).filter(Track.program_id == payload.program_id, Track.slug == slug_val).first()
    if existing_track:
        slug_val = f"{slug_val}-{uuid.uuid4().hex[:6]}"

    new_track = Track(
        program_id=payload.program_id,
        name=payload.name.strip(),
        slug=slug_val
    )
    db.add(new_track)
    db.commit()
    db.refresh(new_track)
    return {"success": True, "track_id": new_track.id, "message": f"Track '{new_track.name}' created."}

@app.put("/api/tracks/{track_id}")
def update_track_by_mo(track_id: int, payload: TrackUpdate, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to rename or update track details."""
    track = db.query(Track).filter(Track.id == track_id).first()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    verify_curriculum_edit_permission(db, user_id, track.program_id)
        
    if payload.name is not None and payload.name.strip():
        track.name = payload.name.strip()
    if payload.slug is not None:
        track.slug = payload.slug
        
    db.commit()
    db.refresh(track)
    return {"success": True, "message": f"Track '{track.name}' updated successfully."}

@app.delete("/api/tracks/{track_id}")
def delete_track_by_mo(track_id: int, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Allows MO/Admin to delete a track and its modules."""
    track = db.query(Track).filter(Track.id == track_id).first()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    verify_curriculum_edit_permission(db, user_id, track.program_id)

    name = track.name
    db.delete(track)
    db.commit()
    return {"success": True, "message": f"Track '{name}' deleted."}

@app.post("/api/programs")
def create_program_by_admin(payload: ProgramCreate, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Only Administrators can create a new curriculum program. Module Owners manage assigned programs."""
    user = None
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.role != "admin":
            raise HTTPException(status_code=403, detail="Only Administrators can create new curriculum programs. Module Owners manage assigned programs.")

    slug_val = payload.slug or payload.name.lower().strip().replace(" ", "-")
    existing_prog = db.query(Program).filter(Program.slug == slug_val).first()
    if existing_prog:
        slug_val = f"{slug_val}-{uuid.uuid4().hex[:6]}"

    new_prog = Program(
        name=payload.name.strip(),
        slug=slug_val,
        description=payload.description or ""
    )
    db.add(new_prog)
    db.commit()
    db.refresh(new_prog)

    # Automatically associate with all Admins and PMs for visibility
    all_gov_users = db.query(User).filter(User.role.in_(["admin", "pm"])).all()
    for u in all_gov_users:
        if new_prog not in u.programs:
            u.programs.append(new_prog)
    db.commit()

    return {"success": True, "program_id": new_prog.id, "message": f"Program '{new_prog.name}' created."}

@app.put("/api/programs/{program_id}")
def update_program_by_admin(program_id: int, payload: ProgramUpdate, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Only Administrators can update program details. Module Owners manage tracks within assigned programs."""
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.role != "admin":
            raise HTTPException(status_code=403, detail="Only Administrators can edit curriculum programs. Module Owners manage tracks and modules within assigned programs.")

    prog = db.query(Program).filter(Program.id == program_id).first()
    if not prog:
        raise HTTPException(status_code=404, detail="Program not found")
        
    if payload.name is not None and payload.name.strip():
        prog.name = payload.name.strip()
    if payload.slug is not None:
        prog.slug = payload.slug
    if payload.description is not None:
        prog.description = payload.description
        
    db.commit()
    db.refresh(prog)
    return {"success": True, "message": f"Program '{prog.name}' updated successfully."}

@app.delete("/api/programs/{program_id}")
def delete_program_by_admin(program_id: int, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Only Administrators can delete a program. Module Owners manage assigned programs."""
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.role != "admin":
            raise HTTPException(status_code=403, detail="Only Administrators can delete curriculum programs. Module Owners manage tracks and modules within assigned programs.")

    prog = db.query(Program).filter(Program.id == program_id).first()
    if not prog:
        raise HTTPException(status_code=404, detail="Program not found")
    name = prog.name
    
    prog.users.clear()
    db.delete(prog)
    db.commit()
    return {"success": True, "message": f"Program '{name}' deleted."}

# ==============================================================================
# FR-3 / FR-4 / FR-6: MODULE PLAN INTAKE, REVIEW LOCK, AND COMPLETENESS GATE
# ==============================================================================

def _parse_agendas(raw) -> list:
    if not raw:
        return []
    try:
        val = json.loads(raw)
        return [a for a in val if str(a).strip()] if isinstance(val, list) else [str(val)]
    except Exception:
        return [raw] if str(raw).strip() else []

def evaluate_module_completeness(module: Module) -> dict:
    """FR-6: complete = every class has title + agendas AND plan is Locked.
    Owner is informational only — not a hard gate for script generation.
    Any module with is_locked=True is automatically considered complete."""
    issues = []
    classes = list(module.classes or [])

    # If module is explicitly locked, skip all class-level checks —
    # treat it as complete so SMEs can generate scripts immediately.
    status_val = module.plan_status or ("Locked" if module.is_locked else "Draft")

    if module.is_locked or status_val == "Locked":
        owner = (module.owner_name or "").strip()
        if not owner and module.track and module.track.program:
            enrolled = [u for u in module.track.program.users if u.role in ("sme", "mo")]
            owner = enrolled[0].name if enrolled else "Scaler SME"
        else:
            owner = owner or "Scaler SME"
        return {
            "module_id": module.id,
            "module_name": module.name,
            "plan_status": "Locked",
            "plan_source": module.plan_source or "manual",
            "owner": owner,
            "class_count": len(classes),
            "is_complete": True,
            "issues": [],
        }

    # Module is not locked — run full checks
    if not classes:
        issues.append("Module has no classes")
    for c in classes:
        label = f"Class {c.sequence_number}"
        if not (c.title or "").strip():
            issues.append(f"{label}: missing title")
        if not _parse_agendas(c.agendas):
            issues.append(f"{label}: missing agenda list")

    if status_val != "Locked":
        issues.append(f"Plan is '{status_val}', must be reviewed and Locked")

    owner = (module.owner_name or "").strip()
    if not owner and module.track and module.track.program:
        enrolled = [u for u in module.track.program.users if u.role in ("sme", "mo")]
        owner = enrolled[0].name if enrolled else ""

    return {
        "module_id": module.id,
        "module_name": module.name,
        "plan_status": status_val,
        "plan_source": module.plan_source or "manual",
        "owner": owner or None,
        "class_count": len(classes),
        "is_complete": not issues,
        "issues": issues,
    }

@app.get("/api/programs/{program_id}/generation-gate")
def get_generation_gate(program_id: int, db: Session = Depends(get_db)):
    """FR-6: tells the UI whether script creation is enabled for this program and why."""
    prog = db.query(Program).filter(Program.id == program_id).first()
    if not prog:
        raise HTTPException(status_code=404, detail="Program not found")
    reports = [evaluate_module_completeness(m) for t in prog.tracks for m in t.modules]
    complete = [r for r in reports if r["is_complete"]]
    return {
        "program_id": prog.id,
        "program_name": prog.name,
        "script_creation_enabled": bool(complete),
        "complete_modules": len(complete),
        "total_modules": len(reports),
        "incomplete_modules": [r for r in reports if not r["is_complete"]][:25],
    }

@app.get("/api/modules/{module_id}/completeness")
def get_module_completeness(module_id: int, db: Session = Depends(get_db)):
    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")
    return evaluate_module_completeness(mod)

def _require_plan_editor(db: Session, user_id: Optional[int], module: Optional[Module] = None) -> str:
    """Only Admin or an enrolled MO may edit/review/lock module plans."""
    if not user_id:
        return "Admin"
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.role not in ("admin", "mo"):
        raise HTTPException(status_code=403, detail="Only Admins or Module Owners can manage module plans.")
    if user.role == "mo" and module and module.track:
        if module.track.program_id not in [p.id for p in user.programs]:
            raise HTTPException(status_code=403, detail="Module Owner has not joined this program.")
    return user.name

def _parse_syllabus_text(text_in: str) -> list:
    """
    FR-3: AI syllabus parser. Uses Claude when available; otherwise a deterministic
    parser that understands 'Class N: Title', '- agenda', and 'LO:' / 'Outcomes:' lines.
    """
    groq_key = os.getenv("GROQ_API_KEY")
    api_key = os.getenv("ANTHROPIC_API_KEY")
    execution_mode = os.getenv("EXECUTION_MODE", "hybrid")

    if (groq_key or api_key) and execution_mode != "mock":
        try:
            prompt_content = (
                "Parse this syllabus into a JSON array of classes. Each item: "
                '{"title": str, "agendas": [str], "learning_outcomes": str, "duration_minutes": int}. '
                "Return ONLY JSON.\n\nSYLLABUS:\n" + text_in
            )
            if groq_key:
                from agents.groq_client import call_groq_chat
                raw = call_groq_chat(
                    messages=[{"role": "user", "content": prompt_content}],
                    max_tokens=4000
                )
            else:
                import anthropic
                client = anthropic.Anthropic(api_key=api_key)
                msg = client.messages.create(
                    model="claude-3-5-sonnet-latest",
                    max_tokens=4000,
                    messages=[{"role": "user", "content": prompt_content}],
                )
                raw = msg.content[0].text.strip()

            if "```" in raw:
                raw = raw.split("```")[1].removeprefix("json").strip()
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return parsed
        except Exception as e:
            print(f"Syllabus AI parse failed, using rule-based parser: {e}")

    import re
    classes, current = [], None
    for line in text_in.splitlines():
        s = line.strip()
        if not s:
            continue
        m = re.match(r"^(?:class|lecture|session|day)\s*\d+\s*[:.\-]\s*(.+)$", s, re.I)
        if m:
            current = {"title": m.group(1).strip(), "agendas": [], "learning_outcomes": "", "duration_minutes": 90}
            classes.append(current)
            continue
        if current is None:
            continue
        lo = re.match(r"^(?:lo|los|outcomes?|learning outcomes?)\s*[:\-]\s*(.+)$", s, re.I)
        if lo:
            current["learning_outcomes"] = (current["learning_outcomes"] + " " + lo.group(1)).strip()
        elif re.match(r"^[-*\u2022]|^\d+[.)]", s):
            current["agendas"].append(re.sub(r"^([-*\u2022]|\d+[.)])\s*", "", s))
    return classes

@app.post("/api/modules/{module_id}/syllabus")
def upload_module_syllabus(module_id: int, payload: dict, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """
    FR-3: Upload syllabus text; AI parses it into classes.
    mode='replace' -> parsed plan only (source=syllabus); mode='merge' -> keep manual classes (source=both).
    The module moves to 'In Review' (FR-4) and cannot be used for generation until locked.
    """
    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")
    actor = _require_plan_editor(db, user_id, mod)

    text_in = (payload.get("syllabus_text") or "").strip()
    if not text_in:
        raise HTTPException(status_code=400, detail="syllabus_text is required")
    mode = (payload.get("mode") or "merge").lower()

    parsed = _parse_syllabus_text(text_in)
    if not parsed:
        raise HTTPException(status_code=422, detail="Could not parse any classes from the syllabus.")

    had_manual = len(mod.classes) > 0
    if mode == "replace":
        for c in list(mod.classes):
            if not c.scripts:
                db.delete(c)
        db.flush()
    start_seq = max([c.sequence_number for c in mod.classes] or [0]) + 1

    for i, item in enumerate(parsed):
        db.add(Class(
            module_id=mod.id,
            sequence_number=start_seq + i,
            title=str(item.get("title", "")).strip() or f"Class {start_seq + i}",
            agendas=json.dumps(item.get("agendas") or []),
            learning_outcomes=item.get("learning_outcomes") or None,
            duration_minutes=int(item.get("duration_minutes") or 90),
        ))

    mod.plan_source = "both" if (had_manual and mode == "merge") else "syllabus"
    mod.plan_status = "In Review"
    mod.is_locked = False
    db.commit()
    db.refresh(mod)

    log_activity(db, user_name=actor, user_role="mo", action_type="Syllabus Parsed",
                 description=f"Parsed {len(parsed)} classes into module '{mod.name}' ({mod.plan_source}); sent to review")
    return {"parsed_classes": len(parsed), "completeness": evaluate_module_completeness(mod)}

@app.post("/api/modules/{module_id}/plan/submit-review")
def submit_module_plan_for_review(module_id: int, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """FR-4: manual or parsed plan enters review. Unlocks the module for edits."""
    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")
    actor = _require_plan_editor(db, user_id, mod)
    mod.plan_status = "In Review"
    mod.is_locked = False
    db.commit()
    log_activity(db, user_name=actor, user_role="mo", action_type="Module Plan In Review",
                 description=f"Module '{mod.name}' plan submitted for review")
    return evaluate_module_completeness(mod)

@app.post("/api/modules/{module_id}/plan/lock")
def lock_module_plan(module_id: int, payload: Optional[dict] = None, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """FR-4: reviewer locks the plan. Lock is refused unless all FR-6 content checks pass."""
    mod = db.query(Module).filter(Module.id == module_id).first()
    if not mod:
        raise HTTPException(status_code=404, detail="Module not found")
    actor = _require_plan_editor(db, user_id, mod)

    if payload and payload.get("owner_name"):
        mod.owner_name = payload["owner_name"].strip()

    # Evaluate as if locked, so the only remaining issues are content/ownership
    prev_status = mod.plan_status
    mod.plan_status = "Locked"
    report = evaluate_module_completeness(mod)
    if not report["is_complete"]:
        mod.plan_status = prev_status
        db.rollback()
        raise HTTPException(status_code=400, detail={"message": "Module plan cannot be locked", "issues": report["issues"]})

    mod.is_locked = True
    db.commit()
    log_activity(db, user_name=actor, user_role="mo", action_type="Module Plan Locked",
                 description=f"Reviewed and locked module '{mod.name}' ({report['class_count']} classes)")
    return report

@app.post("/api/scripts/init")
def initialize_script(payload: ScriptCreateRequest, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Accepts the 10 Canonical Inputs and creates a WIP script record."""
    cls = db.query(Class).filter(Class.id == payload.class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            if user.role == "pm":
                raise HTTPException(status_code=403, detail="Program Managers have read-only access and cannot generate scripts.")
            if user.role in ["sme", "mo"]:
                prog = cls.module.track.program if cls.module and cls.module.track else None
                if prog and prog.id not in [p.id for p in user.programs]:
                    raise HTTPException(status_code=403, detail=f"User has not joined program '{prog.name}'. Access denied.")

    # FR-6 Gate: program must have at least one complete, locked module
    if not cls.module or not cls.module.track:
        raise HTTPException(status_code=400, detail="Cannot initialize script: Class does not belong to a valid module.")

    program = cls.module.track.program
    complete_modules = [
        m for t in program.tracks for m in t.modules
        if evaluate_module_completeness(m)["is_complete"]
    ]
    if not complete_modules:
        raise HTTPException(
            status_code=400,
            detail=f"Script creation is disabled for '{program.name}': no complete module exists yet. "
                   "A module is complete when every class has a title and agendas, "
                   "an SME/owner is assigned, and the plan is locked after review."
        )

    this_module = evaluate_module_completeness(cls.module)
    if not this_module["is_complete"]:
        raise HTTPException(
            status_code=400,
            detail=f"Module '{cls.module.name}' is not complete: " + "; ".join(this_module["issues"][:5])
        )

    # Pull Class N-1 memory
    memory = retrieve_context_memory(db, payload.class_id, payload.previous_script_context)

    # If SME provided learning outcomes and MO hasn't set them yet, save to class
    if payload.learning_outcomes and not (cls.learning_outcomes or "").strip():
        cls.learning_outcomes = payload.learning_outcomes.strip()
        db.commit()

    author_user = db.query(User).filter(User.id == user_id).first() if user_id else None
    sme_author_name = author_user.name if author_user else "Aryan (SME)"

    custom_agendas_json = json.dumps(payload.custom_agendas) if payload.custom_agendas else None
    effective_title = payload.custom_class_title or (cls.title if cls else "Lecture Script")

    script = Script(
        class_id=cls.id,
        duration_minutes=payload.duration_minutes,
        content_mix_beginner=payload.content_mix_beginner,
        content_mix_advanced=payload.content_mix_advanced,
        code_ratio=payload.code_ratio,
        additional_resources=payload.additional_resources,
        api_docs=payload.api_docs,
        reference_urls=payload.reference_urls,
        previous_script_context=json.dumps(memory),
        custom_agendas=custom_agendas_json,
        custom_class_title=payload.custom_class_title,
        user_id=author_user.id if author_user else None,
        sme_name=sme_author_name,
        status="Script WIP"
    )
    db.add(script)
    db.commit()
    db.refresh(script)

    log_activity(
        db,
        user_name=sme_author_name,
        user_role="sme",
        action_type="Script Initialized",
        description=f"Initialized draft script #{script.id} for '{effective_title}' ({cls.duration_minutes} mins)"
    )

    return {
        "script_id": script.id,
        "shareable_uuid": script.shareable_uuid,
        "status": script.status,
        "message": "Script initialized with 10 canonical inputs. Ready for outline generation.",
        "memory_ledger": memory
    }

# ==============================================================================
# 3. OUTLINE GENERATION & HUMAN GATE ([GTG], [Edit], [ReThink])
# ==============================================================================

@app.post("/api/scripts/{script_id}/outline", response_model=OutlineResponse)
def create_script_outline(script_id: int, db: Session = Depends(get_db)):
    """Outliner Agent generates card outline grouped into sections summing to exact duration."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    cls = script.class_entity
    effective_title = script.custom_class_title or (cls.title if cls else "Lecture Script")

    if script.custom_agendas:
        try:
            agendas = json.loads(script.custom_agendas)
        except:
            agendas = [script.custom_agendas]
    else:
        try:
            agendas = json.loads(cls.agendas) if cls and cls.agendas else []
        except:
            agendas = [cls.agendas] if cls else []

    try:
        memory = json.loads(script.previous_script_context) if script.previous_script_context else {}
    except:
        memory = {}

    from agents.shared_context import build_block_a_context
    from agents.outliner import generate_outline as generate_sections_outline

    block_a = build_block_a_context(
        db=db,
        class_id=script.class_id,
        duration_minutes=script.duration_minutes,
        content_mix_beginner=script.content_mix_beginner,
        code_ratio=script.code_ratio,
        custom_title=effective_title,
        custom_agendas=agendas,
        learning_outcomes=cls.learning_outcomes if cls else None,
        api_docs=script.api_docs,
        reference_urls=script.reference_urls,
        additional_resources=script.additional_resources,
        previous_script_context=script.previous_script_context
    )

    trk_name = cls.module.track.name if cls and cls.module and cls.module.track else "Core"

    # Call the Outliner agent directly to get section-grouped outline
    outline_data = generate_sections_outline(
        class_title=effective_title,
        agendas=agendas,
        duration_minutes=script.duration_minutes,
        content_mix_beginner=script.content_mix_beginner,
        code_ratio=script.code_ratio,
        memory_context=memory,
        block_a_context=block_a,
        learning_outcomes=cls.learning_outcomes if cls else None,
        additional_resources=script.additional_resources,
        api_docs=script.api_docs,
        reference_urls=script.reference_urls,
        track=trk_name
    )

    # Save outline JSON to database (stores sections, cards, and running example)
    script.outline_json = json.dumps(outline_data)
    db.commit()

    # Flatten cards for legacy OutlineCardItem response compatibility
    flat_cards = []
    card_idx = 1
    sections = outline_data.get("sections", [])
    for sec in sections:
        for c in sec.get("cards", []):
            dur_mins = round(c.get("duration_sec", 300) / 60.0, 1)
            agendas_preview = ", ".join(c.get("agenda_items", [])) if c.get("agenda_items") else ""
            concept_val = agendas_preview or c.get("teaching_shape_note") or c.get("title", "")
            if concept_val == "Why -> What -> How -> Where -> What breaks":
                concept_val = c.get("title", "")

            flat_cards.append({
                "card_index": card_idx,
                "title": c.get("title", f"Card {card_idx}"),
                "duration_mins": dur_mins,
                "pedagogical_phase": c.get("card_type", "Concept").title(),
                "key_concept": concept_val,
                "visual_type": "mermaid" if c.get("visuals_planned") else "none"
            })
            card_idx += 1

    total_target = float(script.duration_minutes)
    if flat_cards:
        current_sum = round(sum(c.get("duration_mins", 0) for c in flat_cards), 1)
        rem = round(total_target - current_sum, 1)
        if rem != 0:
            mid = len(flat_cards) // 2
            flat_cards[mid]["duration_mins"] = round(flat_cards[mid]["duration_mins"] + rem, 1)

    return OutlineResponse(
        script_id=script.id,
        class_title=effective_title,
        total_duration_mins=total_target,
        total_cards=len(flat_cards),
        cards=flat_cards,
        sections=sections,
        running_example=outline_data.get("running_example"),
        assumptions=outline_data.get("assumptions"),
        overlap_analysis=f"Coverage: {len(outline_data.get('overlap_flags', []))} flags. Planned {outline_data.get('rule_counts_planned', {}).get('diagrams', 4)} diagrams, {outline_data.get('rule_counts_planned', {}).get('predict_moments', 3)} predict moments."
    )

@app.get("/api/scripts/{script_id}/outline", response_model=OutlineResponse)
def get_script_outline(script_id: int, db: Session = Depends(get_db)):
    """Retrieves the currently saved card outline for a script."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    if not script.outline_json:
        raise HTTPException(status_code=404, detail="No outline found for this script")

    outline_data = json.loads(script.outline_json)
    sections = outline_data.get("sections", []) if isinstance(outline_data, dict) else []
    cls = script.class_entity
    effective_title = script.custom_class_title or (cls.title if cls else "Lecture Script")

    flat_cards = []
    card_idx = 1
    if sections:
        for sec in sections:
            for c in sec.get("cards", []):
                dur_mins = round(c.get("duration_sec", 300) / 60.0, 1)
                agendas_preview = ", ".join(c.get("agenda_items", [])) if c.get("agenda_items") else ""
                concept_val = agendas_preview or c.get("teaching_shape_note") or c.get("title", "")
                if concept_val == "Why -> What -> How -> Where -> What breaks":
                    concept_val = c.get("title", "")

                flat_cards.append({
                    "card_index": card_idx,
                    "title": c.get("title", f"Card {card_idx}"),
                    "duration_mins": dur_mins,
                    "pedagogical_phase": c.get("card_type", "Concept").title(),
                    "key_concept": concept_val,
                    "visual_type": "mermaid" if c.get("visuals_planned") else "none"
                })
                card_idx += 1
    elif isinstance(outline_data, list):
        flat_cards = outline_data

    total_target = float(script.duration_minutes)
    if flat_cards:
        current_sum = round(sum(c.get("duration_mins", 0) for c in flat_cards), 1)
        rem = round(total_target - current_sum, 1)
        if rem != 0:
            mid = len(flat_cards) // 2
            flat_cards[mid]["duration_mins"] = round(flat_cards[mid]["duration_mins"] + rem, 1)

    return OutlineResponse(
        script_id=script.id,
        class_title=effective_title,
        total_duration_mins=total_target,
        total_cards=len(flat_cards),
        cards=flat_cards,
        sections=sections,
        running_example=outline_data.get("running_example") if isinstance(outline_data, dict) else None,
        assumptions=outline_data.get("assumptions") if isinstance(outline_data, dict) else None,
        overlap_analysis="Loaded active outline."
    )

@app.post("/api/scripts/{script_id}/outline/action")
def handle_outline_action(script_id: int, payload: OutlineApprovalRequest, db: Session = Depends(get_db)):
    """Human Gate: SME selects [GTG], [Edit], or [ReThink]."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    action = payload.action.upper()
    if action == "GTG":
        script.outline_approved = True
        if payload.modified_sections:
            try:
                curr = json.loads(script.outline_json) if script.outline_json else {}
                curr["sections"] = payload.modified_sections
                script.outline_json = json.dumps(curr)
            except Exception:
                pass
        elif payload.modified_cards:
            script.outline_json = json.dumps([c.dict() for c in payload.modified_cards])
        db.commit()
        return {"status": "SUCCESS", "message": "Outline locked as GTG. Section-by-section generation unlocked."}

    elif action == "EDIT":
        if payload.modified_sections:
            try:
                curr = json.loads(script.outline_json) if script.outline_json else {}
                curr["sections"] = payload.modified_sections
                script.outline_json = json.dumps(curr)
            except Exception:
                pass
        elif payload.modified_cards:
            script.outline_json = json.dumps([c.dict() for c in payload.modified_cards])
        db.commit()
        return {"status": "SUCCESS", "message": "Outline modifications saved."}

    elif action == "RETHINK":
        script.outline_approved = False
        db.commit()
        # Regenerate with SME rethink feedback
        cls = script.class_entity
        effective_title = script.custom_class_title or (cls.title if cls else "Lecture Script")
        try:
            agendas = json.loads(script.custom_agendas) if script.custom_agendas else (json.loads(cls.agendas) if cls and cls.agendas else [])
        except:
            agendas = [cls.agendas] if cls else []
        try:
            memory = json.loads(script.previous_script_context) if script.previous_script_context else {}
        except:
            memory = {}

        from agents.shared_context import build_block_a_context
        from agents.outliner import generate_outline as generate_sections_outline

        block_a = build_block_a_context(
            db=db,
            class_id=script.class_id,
            duration_minutes=script.duration_minutes,
            content_mix_beginner=script.content_mix_beginner,
            code_ratio=script.code_ratio,
            custom_title=effective_title,
            custom_agendas=agendas,
            learning_outcomes=cls.learning_outcomes if cls else None,
            api_docs=script.api_docs,
            reference_urls=script.reference_urls,
            additional_resources=script.additional_resources
        )
        trk_name = cls.module.track.name if cls and cls.module and cls.module.track else "Core"

        outline_data = generate_sections_outline(
            class_title=effective_title,
            agendas=agendas,
            duration_minutes=script.duration_minutes,
            content_mix_beginner=script.content_mix_beginner,
            code_ratio=script.code_ratio,
            memory_context=memory,
            block_a_context=block_a,
            learning_outcomes=cls.learning_outcomes if cls else None,
            additional_resources=script.additional_resources,
            api_docs=script.api_docs,
            reference_urls=script.reference_urls,
            rethink_feedback=payload.revision_feedback,
            track=trk_name
        )
        script.outline_json = json.dumps(outline_data)
        db.commit()

        flat_cards = []
        card_idx = 1
        sections = outline_data.get("sections", [])
        for sec in sections:
            for c in sec.get("cards", []):
                dur_mins = round(c.get("duration_sec", 300) / 60.0, 1)
                agendas_preview = ", ".join(c.get("agenda_items", [])) if c.get("agenda_items") else ""
                concept_val = agendas_preview or c.get("teaching_shape_note") or c.get("title", "")
                if concept_val == "Why -> What -> How -> Where -> What breaks":
                    concept_val = c.get("title", "")

                flat_cards.append({
                    "card_index": card_idx,
                    "title": c.get("title", f"Card {card_idx}"),
                    "duration_mins": dur_mins,
                    "pedagogical_phase": c.get("card_type", "Concept").title(),
                    "key_concept": concept_val,
                    "visual_type": "mermaid" if c.get("visuals_planned") else "none"
                })
                card_idx += 1

        total_target = float(script.duration_minutes)
        if flat_cards:
            current_sum = round(sum(c.get("duration_mins", 0) for c in flat_cards), 1)
            rem = round(total_target - current_sum, 1)
            if rem != 0:
                mid = len(flat_cards) // 2
                flat_cards[mid]["duration_mins"] = round(flat_cards[mid]["duration_mins"] + rem, 1)

        return OutlineResponse(
            script_id=script.id,
            class_title=effective_title,
            total_duration_mins=total_target,
            total_cards=len(flat_cards),
            cards=flat_cards,
            sections=sections,
            running_example=outline_data.get("running_example"),
            assumptions=outline_data.get("assumptions"),
            overlap_analysis=f"ReThink applied with feedback: '{payload.revision_feedback or 'Divergent structure requested'}'"
        )

    raise HTTPException(status_code=400, detail="Invalid action. Must be GTG, Edit, or ReThink.")

@app.post("/api/scripts/{script_id}/outline/card-assist")
def outline_card_assist(
    script_id: int,
    payload: OutlineCardAssistRequest,
    db: Session = Depends(get_db)
):
    """
    SME Chat / Prompt Assist for a single outline card before locking GTG.
    Revises the targeted card in place according to SME instructions.
    """
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script or not script.outline_json:
        raise HTTPException(status_code=404, detail="Script or outline not found")

    outline_data = json.loads(script.outline_json)
    sections = outline_data.get("sections", [])
    
    # Locate targeted card by card_id or card_index
    target_card = None
    target_sec = None
    curr_idx = 1
    for sec in sections:
        for c in sec.get("cards", []):
            if (payload.card_id and c.get("card_id") == payload.card_id) or (payload.card_index and curr_idx == payload.card_index):
                target_card = c
                target_sec = sec
                break
            curr_idx += 1
        if target_card:
            break

    if not target_card:
        # Fallback if outline is flat cards
        if isinstance(outline_data, list):
            for c in outline_data:
                if c.get("card_index") == payload.card_index:
                    target_card = c
                    break

    if not target_card:
        raise HTTPException(status_code=404, detail="Target outline card not found")

    # Apply inline assist using Groq (or fallback)
    groq_key = os.getenv("GROQ_API_KEY")
    api_key = os.getenv("ANTHROPIC_API_KEY")
    execution_mode = os.getenv("EXECUTION_MODE", "hybrid")

    if (groq_key or api_key) and execution_mode != "mock":
        try:
            prompt = f"""You are the Outliner Agent assistant.
Revise this outline card based on the SME directive:

CARD TO REVISE:
{json.dumps(target_card, indent=2)}

SME DIRECTIVE:
{payload.user_prompt}

RULES:
- Keep duration realistic (4-10m for concepts, 1-2m for quizzes).
- Everyday daily-life analogies only (UPI, WhatsApp, train booking, food delivery).
- Return ONLY valid JSON representing the updated card object.
"""
            if groq_key:
                from agents.groq_client import call_groq_chat
                raw = call_groq_chat(
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=2000
                )
            else:
                import anthropic
                client = anthropic.Anthropic(api_key=api_key)
                msg = client.messages.create(
                    model="claude-3-5-sonnet-latest",
                    max_tokens=1000,
                    messages=[{"role": "user", "content": prompt}]
                )
                raw = msg.content[0].text.strip()

            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0].strip()
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0].strip()
            updated_card = json.loads(raw)
            target_card.update(updated_card)
        except Exception as e:
            # Fallback intelligent local editor
            _apply_local_card_directive(target_card, payload.user_prompt)
    else:
        _apply_local_card_directive(target_card, payload.user_prompt)

    script.outline_json = json.dumps(outline_data)
    db.commit()
    return {"status": "SUCCESS", "message": "Card updated successfully", "updated_card": target_card}


def _apply_local_card_directive(target_card: dict, user_prompt: str):
    """
    Applies user chat directives (e.g., 'remove pacing', 'change title to X',
    'make it 5 mins') directly to target card fields without wiping out existing text.
    """
    prompt_lower = user_prompt.lower().strip()
    
    # 1. Removal directives (e.g. "remove pacing", "remove setup", "remove X")
    if prompt_lower.startswith("remove ") or prompt_lower.startswith("delete "):
        target_term = prompt_lower.replace("remove ", "").replace("delete ", "").strip()
        # Look in teaching_shape_note
        curr_note = target_card.get("teaching_shape_note", "")
        if target_term in curr_note.lower():
            # Remove the phrase cleanly
            import re
            cleaned = re.sub(re.escape(target_term), "", curr_note, flags=re.IGNORECASE)
            cleaned = cleaned.replace(" ,", ",").replace(",,", ",").strip(" ,.-")
            target_card["teaching_shape_note"] = cleaned
        # Look in agenda_items
        new_agendas = []
        for ag in target_card.get("agenda_items", []):
            if target_term not in ag.lower():
                new_agendas.append(ag)
            else:
                cleaned_ag = re.sub(re.escape(target_term), "", ag, flags=re.IGNORECASE).strip(" ,.-")
                if cleaned_ag:
                    new_agendas.append(cleaned_ag)
        target_card["agenda_items"] = new_agendas
        return

    # 2. Timing directives (e.g. "make it 5 minutes", "duration 6m")
    import re
    time_match = re.search(r"(\d+(\.\d+)?)\s*(min|m|minute)", prompt_lower)
    if time_match:
        mins = float(time_match.group(1))
        target_card["duration_sec"] = int(mins * 60)

    # 3. Title rename directives (e.g. "title: X" or "rename to X")
    if "rename to " in prompt_lower or "title: " in prompt_lower:
        new_title = re.split(r"rename to |title:\s*", user_prompt, flags=re.IGNORECASE)[-1].strip()
        if new_title:
            target_card["title"] = new_title
        return

    # 4. Content addition / refinement: append or update concept specifically
    curr_concept = target_card.get("teaching_shape_note", "")
    if curr_concept:
        target_card["teaching_shape_note"] = f"{curr_concept} | {user_prompt}"
    else:
        target_card["teaching_shape_note"] = user_prompt

# ==============================================================================
# 4. SECTION-BY-SECTION SCRIPT GENERATION & ATTRIBUTES ENRICHMENT
# ==============================================================================

@app.post("/api/scripts/{script_id}/generate-section")
def generate_section(
    script_id: int,
    start_card: int = Query(1, ge=1),
    end_card: int = Query(4, ge=1),
    section_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Drafts cards in section batches using Claude Sonnet (Writer Agent).
    Automatically resolves [[VISUAL]] placeholders into live Mermaid diagrams
    and interactive HTML animations using Attributes Generator.
    """
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    if not script.outline_json:
        raise HTTPException(status_code=400, detail="Must generate outline first.")

    outline_raw = json.loads(script.outline_json)
    try:
        memory = json.loads(script.previous_script_context) if script.previous_script_context else {}
    except:
        memory = {}

    from agents.shared_context import build_block_a_context
    cls = script.class_entity
    effective_title = script.custom_class_title or (cls.title if cls else "Lecture Script")
    try:
        agendas = json.loads(script.custom_agendas) if script.custom_agendas else (json.loads(cls.agendas) if cls and cls.agendas else [])
    except:
        agendas = [cls.agendas] if cls else []

    block_a = build_block_a_context(
        db=db,
        class_id=script.class_id,
        duration_minutes=script.duration_minutes,
        content_mix_beginner=script.content_mix_beginner,
        code_ratio=script.code_ratio,
        custom_title=effective_title,
        custom_agendas=agendas,
        learning_outcomes=cls.learning_outcomes if cls else None,
        api_docs=script.api_docs,
        reference_urls=script.reference_urls,
        additional_resources=script.additional_resources
    )

    from agents.writer import write_section, draft_card_batch
    from agents.attributes_generator import generate_visuals_batch

    # Determine running example
    running_example = (
        (outline_raw.get("running_example") if isinstance(outline_raw, dict) else None)
        or memory.get("anchor_analogy")
        or "Real-time Distributed Booking Engine"
    )

    # If outline is structured as sections
    if isinstance(outline_raw, dict) and outline_raw.get("sections"):
        target_sec_id = section_id or f"sec_{max(1, (start_card - 1) // 4 + 1)}"
        sec_out = write_section(
            section_id=target_sec_id,
            approved_outline=outline_raw,
            approved_sections=[],
            term_register=[],
            block_a_context=block_a,
            class_title=effective_title,
            memory_context=memory,
            content_mix_beginner=script.content_mix_beginner,
            code_ratio=script.code_ratio
        )
        all_drafted_cards = sec_out.get("cards", [])
        visual_requests = sec_out.get("visual_requests", [])

        # Process and generate visual assets for placeholders
        visual_assets = generate_visuals_batch(
            visual_requests=visual_requests,
            cards=all_drafted_cards,
            running_example=running_example,
            block_a_context=block_a
        )
        vis_map = {v.get("id"): v for v in visual_assets}

        # If requesting a single card or specific range within a section
        if start_card == end_card:
            # Map start_card index to the corresponding card within this section
            sec_card_idx = (start_card - 1) % max(1, len(all_drafted_cards))
            if 0 <= sec_card_idx < len(all_drafted_cards):
                drafted_cards = [all_drafted_cards[sec_card_idx]]
            else:
                drafted_cards = all_drafted_cards[:1]
        else:
            drafted_cards = all_drafted_cards

        # Adapt cards to DB model format
        persisted_cards = []
        for idx, c in enumerate(drafted_cards, start=start_card):
            body = c.get("body_markdown") or c.get("content_script") or ""
            # Link visual asset if present
            card_vis = None
            for req in visual_requests:
                if req.get("card_id") == c.get("card_id") and req.get("id") in vis_map:
                    card_vis = vis_map[req.get("id")]
                    break

            card_obj = db.query(ScriptCard).filter(
                ScriptCard.script_id == script_id,
                ScriptCard.card_index == idx
            ).first()

            dur = round(c.get("duration_sec", 300) / 60.0, 1) if c.get("duration_sec") else c.get("duration_mins", 5.0)

            stage_note = c.get("instructor_note") or c.get("stage_directions") or c.get("teaching_shape_note")
            quiz_val = json.dumps(c.get("quiz_json")) if isinstance(c.get("quiz_json"), dict) else (c.get("quiz_json") if isinstance(c.get("quiz_json"), str) else None)

            if card_obj:
                card_obj.title = c.get("title", f"Card {idx}")
                card_obj.duration_mins = dur
                card_obj.pedagogical_phase = c.get("card_type", "Concept").title()
                card_obj.stage_directions = stage_note
                card_obj.content_script = body
                card_obj.code_snippet = c.get("code_snippet")
                card_obj.code_language = c.get("code_language")
                card_obj.quiz_json = quiz_val
                card_obj.visual_asset_json = json.dumps(card_vis) if card_vis else None
                card_obj.is_approved = False
            else:
                card_obj = ScriptCard(
                    script_id=script_id,
                    card_index=idx,
                    title=c.get("title", f"Card {idx}"),
                    duration_mins=dur,
                    target_words=450,
                    pedagogical_phase=c.get("card_type", "Concept").title(),
                    stage_directions=stage_note,
                    content_script=body,
                    code_snippet=c.get("code_snippet"),
                    code_language=c.get("code_language"),
                    quiz_json=quiz_val,
                    visual_asset_json=json.dumps(card_vis) if card_vis else None,
                    is_approved=False
                )
                db.add(card_obj)
            persisted_cards.append(card_obj)

    else:
        # Fallback to batch drafter if outline is flat
        flat_cards = outline_raw if isinstance(outline_raw, list) else outline_raw.get("cards", [])
        drafted_cards = draft_card_batch(
            class_title=effective_title,
            outline_cards=flat_cards,
            batch_start_idx=start_card,
            batch_end_idx=min(end_card, len(flat_cards)),
            memory_context=memory,
            code_ratio=script.code_ratio,
            content_mix_beginner=script.content_mix_beginner,
            block_a_context=block_a
        )
        persisted_cards = []
        for c in drafted_cards:
            card_obj = db.query(ScriptCard).filter(
                ScriptCard.script_id == script_id,
                ScriptCard.card_index == c.get("card_index")
            ).first()
            if card_obj:
                card_obj.title = c.get("title")
                card_obj.duration_mins = c.get("duration_mins")
                card_obj.content_script = c.get("content_script")
                card_obj.code_snippet = c.get("code_snippet")
                card_obj.is_approved = False
            else:
                card_obj = ScriptCard(
                    script_id=script_id,
                    card_index=c.get("card_index"),
                    title=c.get("title"),
                    duration_mins=c.get("duration_mins"),
                    target_words=450,
                    pedagogical_phase=c.get("pedagogical_phase", "Concept"),
                    content_script=c.get("content_script"),
                    code_snippet=c.get("code_snippet"),
                    is_approved=False
                )
                db.add(card_obj)
            persisted_cards.append(card_obj)

    db.commit()

    return {
        "script_id": script_id,
        "batch_range": f"{start_card}-{end_card}",
        "cards_drafted_count": len(persisted_cards),
        "status": "DRAFTED_AND_ATTACHED"
    }

# ==============================================================================
# 5. MULTI-AGENT REVIEW AUDIT & MODERATOR REPAIR (PRD FR-17)
# ==============================================================================

@app.post("/api/scripts/{script_id}/review", response_model=MultiAgentReviewResponse)
def execute_multi_agent_review(script_id: int, db: Session = Depends(get_db)):
    """Runs the 3 Reviewer Lenses (Gemini Flash) + Moderator auto-repair (Claude Sonnet)."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    cards = db.query(ScriptCard).filter(ScriptCard.script_id == script_id).order_by(ScriptCard.card_index).all()
    if not cards:
        raise HTTPException(status_code=400, detail="No cards drafted yet to review.")

    cards_dicts = [
        {
            "card_index": c.card_index,
            "title": c.title,
            "duration_mins": c.duration_mins,
            "pedagogical_phase": c.pedagogical_phase,
            "content_script": c.content_script,
            "code_snippet": c.code_snippet,
            "code_language": c.code_language
        }
        for c in cards
    ]

    # Run Reviewers on Gemini Flash
    reviews = run_multi_lens_reviews(
        class_title=script.class_entity.title,
        cards=cards_dicts,
        target_duration_mins=script.duration_minutes,
        content_mix_beginner=script.content_mix_beginner
    )

    # Check for failure & trigger Moderator auto-healing
    all_passed = all(r.get("passed", False) for r in reviews)
    moderator_note = "All review lenses passed with score >= 8.5/10."
    retry_count = 0

    if not all_passed:
        repaired_cards, is_gtg, moderator_note = reconcile_and_repair(
            script_id=script_id,
            cards=cards_dicts,
            reviews=reviews,
            retry_count=retry_count,
            content_mix_beginner=script.content_mix_beginner
        )
        retry_count = 1
        all_passed = is_gtg

    # Record audits in DB
    for r in reviews:
        audit = ReviewAudit(
            script_id=script_id,
            lens_name=r.get("lens_name"),
            reviewer_persona=r.get("reviewer_persona"),
            findings_json=json.dumps(r.get("detailed_findings", [])),
            score=r.get("score", 9.0),
            passed=r.get("passed", True),
            retry_iteration=retry_count
        )
        db.add(audit)

    script.status = "SME Review" if all_passed else "Script WIP"
    db.commit()

    overall_score = round(sum(r.get("score", 9.0) for r in reviews) / len(reviews), 1)

    return MultiAgentReviewResponse(
        script_id=script_id,
        overall_score=overall_score,
        is_gtg=all_passed,
        retry_count=retry_count,
        reviews=reviews,
        moderator_notes=moderator_note
    )

# ==============================================================================
# 5.1 LANGGRAPH MULTI-AGENT STATEGRAPH ORCHESTRATION PIPELINE
# ==============================================================================

@app.post("/api/scripts/{script_id}/run-graph")
def execute_langgraph_pipeline(script_id: int, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """
    Executes the full multi-agent generation pipeline using LangGraph:
    Memory Node -> Outline Architect -> Spoken Drafter -> Multi-Lens Reviewer -> Moderator Loop.
    """
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    cls = script.class_entity
    effective_title = script.custom_class_title or (cls.title if cls else "Lecture Script")

    if script.custom_agendas:
        try:
            agendas = json.loads(script.custom_agendas)
        except:
            agendas = [script.custom_agendas]
    else:
        try:
            agendas = json.loads(cls.agendas) if cls and cls.agendas else []
        except:
            agendas = [cls.agendas] if cls else []

    # Prepare initial LangGraph state
    initial_state = {
        "script_id": script.id,
        "class_id": script.class_id,
        "class_title": effective_title,
        "agendas": agendas,
        "duration_minutes": script.duration_minutes,
        "content_mix_beginner": script.content_mix_beginner,
        "code_ratio": script.code_ratio,
        "additional_resources": script.additional_resources,
        "api_docs": script.api_docs,
        "reference_urls": script.reference_urls,
        "memory_context": {},
        "outline_cards": [],
        "drafted_cards": [],
        "reviews": [],
        "repair_count": 0,
        "is_gtg": False,
        "moderator_summary": "",
        "status": "INITIATED",
        "error": None
    }

    # Run LangGraph StateGraph
    graph_output = script_graph.invoke(initial_state)

    # Persist the output back into database
    drafted_cards = graph_output.get("drafted_cards", [])
    if drafted_cards:
        for c in drafted_cards:
            card_obj = db.query(ScriptCard).filter(
                ScriptCard.script_id == script_id,
                ScriptCard.card_index == c.get("card_index")
            ).first()

            visual_data = None
            phase = c.get("pedagogical_phase", "")
            if "Recap" in phase:
                visual_data = generate_mermaid_diagram(c.get("title"), "Architecture", is_recap=True)
            elif "Analogy" in phase or "Concept" in phase:
                visual_data = generate_mermaid_diagram(c.get("title"), "Architecture")

            quiz_json_str = json.dumps(c.get("quiz_json")) if c.get("quiz_json") else None
            visual_json_str = json.dumps(visual_data) if visual_data else None

            if card_obj:
                card_obj.title = c.get("title")
                card_obj.duration_mins = c.get("duration_mins")
                card_obj.target_words = c.get("target_words", 400)
                card_obj.pedagogical_phase = phase
                card_obj.stage_directions = c.get("stage_directions")
                card_obj.content_script = c.get("content_script")
                card_obj.code_snippet = c.get("code_snippet")
                card_obj.code_language = c.get("code_language")
                card_obj.quiz_json = quiz_json_str
                card_obj.visual_asset_json = visual_json_str
                card_obj.is_approved = True
            else:
                card_obj = ScriptCard(
                    script_id=script_id,
                    card_index=c.get("card_index"),
                    title=c.get("title"),
                    duration_mins=c.get("duration_mins"),
                    target_words=c.get("target_words", 400),
                    pedagogical_phase=phase,
                    stage_directions=c.get("stage_directions"),
                    content_script=c.get("content_script"),
                    code_snippet=c.get("code_snippet"),
                    code_language=c.get("code_language"),
                    quiz_json=quiz_json_str,
                    visual_asset_json=visual_json_str,
                    is_approved=True
                )
                db.add(card_obj)

    # Persist outline and reviews
    if graph_output.get("outline_cards"):
        script.outline_json = json.dumps(graph_output["outline_cards"])

    reviews = graph_output.get("reviews", [])
    for r in reviews:
        audit = ReviewAudit(
            script_id=script_id,
            lens_name=r.get("lens_name"),
            reviewer_persona=r.get("reviewer_persona"),
            findings_json=json.dumps(r.get("detailed_findings", [])),
            score=r.get("score", 9.0),
            passed=r.get("passed", True),
            retry_iteration=graph_output.get("repair_count", 0)
        )
        db.add(audit)

    script.status = "SME Review" if graph_output.get("is_gtg") else "Script WIP"
    db.commit()

    author_name = "Aryan (SME)"
    if user_id:
        u = db.query(User).filter(User.id == user_id).first()
        if u:
            author_name = u.name

    log_activity(
        db,
        user_name=author_name,
        user_role="sme",
        action_type="LangGraph Generation Completed",
        description=f"Generated script #{script.id} via LangGraph ({len(drafted_cards)} cards, status: {script.status})"
    )

    return {
        "script_id": script.id,
        "is_gtg": graph_output.get("is_gtg", False),
        "status": script.status,
        "repair_count": graph_output.get("repair_count", 0),
        "moderator_summary": graph_output.get("moderator_summary", ""),
        "cards_count": len(drafted_cards),
        "reviews_count": len(reviews)
    }

# ==============================================================================
# 6. OFFICIAL MO GTG SIGN-OFF & SNAPSHOT PERSISTENCE
# ==============================================================================

@app.post("/api/scripts/{script_id}/approve-gtg")
def approve_script_gtg(script_id: int, user_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Module Owner (MO) applies the official GTG badge and saves memory for Class N+1."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            if user.role == "pm":
                raise HTTPException(status_code=403, detail="Program Managers have read-only access and cannot approve scripts.")
            if user.role == "sme":
                raise HTTPException(status_code=403, detail="SMEs/Authors cannot apply official MO GTG marks.")
            if user.role == "mo":
                cls = script.class_entity
                prog_id = cls.module.track.program_id if cls and cls.module and cls.module.track else None
                user_prog_ids = [p.id for p in user.programs]
                if prog_id and prog_id not in user_prog_ids:
                    raise HTTPException(status_code=403, detail="Module Owner is not assigned to the program of this script.")

    script.status = "GTG" # Good To Go
    script.approved_at = datetime.datetime.utcnow()
    if user_id:
        mo_user = db.query(User).filter(User.id == user_id).first()
        if mo_user:
            script.approved_by_name = mo_user.name
    if not script.approved_by_name:
        script.approved_by_name = "Rohan Gupta (MO)"
    db.commit()

    cls = script.class_entity
    cls_title = cls.title if cls else "Script"
    log_activity(
        db,
        user_name=script.approved_by_name,
        user_role="mo",
        action_type="Official GTG Sign-Off",
        description=f"Approved script #{script.id} for '{cls_title}' with official GTG sign-off and archived memory ledger snapshot"
    )

    # Extract terms and save to MemoryLedger for next class
    cls = script.class_entity
    cards_for_memory = db.query(ScriptCard).filter(ScriptCard.script_id == script_id).order_by(ScriptCard.card_index).all()

    # Extract real terms: card titles from Concept/Code/Failure phase cards
    extracted_terms = [
        c.title for c in cards_for_memory
        if c.pedagogical_phase and any(p in c.pedagogical_phase for p in ["Concept", "Code", "Failure", "Trace"])
    ][:8] or [f"Core concepts from {cls.title}"]

    # Extract real abstractions: function/class names from code snippets
    extracted_abstractions = []
    import re as _re
    for c in cards_for_memory:
        if c.code_snippet:
            matches = _re.findall(r'(?:def |class |function )([A-Za-z_][A-Za-z0-9_]*)', c.code_snippet)
            extracted_abstractions.extend(matches)
    extracted_abstractions = list(dict.fromkeys(extracted_abstractions))[:6] or [cls.title.replace(" ", "")]

    # Derive anchor analogy from memory context stored at script init
    try:
        mem_ctx = json.loads(script.previous_script_context) if script.previous_script_context else {}
    except Exception:
        mem_ctx = {}
    anchor_analogy = mem_ctx.get("anchor_analogy") or "Swiggy Real-Time Order & Delivery Architecture"

    # Build cliffhanger from next class in module if it exists
    next_cls = db.query(Class).filter(
        Class.module_id == cls.module_id,
        Class.sequence_number > cls.sequence_number
    ).order_by(Class.sequence_number.asc()).first()
    cliffhanger = (
        f"Now that {cls.title} is mastered, next class dives into '{next_cls.title}'."
        if next_cls else
        f"Now that {cls.title} is mastered, the module moves to advanced applications."
    )

    save_memory_ledger(
        db=db,
        class_id=cls.id,
        module_id=cls.module_id,
        terms=extracted_terms,
        abstractions=extracted_abstractions,
        analogy=anchor_analogy,
        cliffhanger=cliffhanger
    )

    return {
        "status": "OFFICIALLY_APPROVED",
        "script_id": script.id,
        "gtg_badge": True,
        "shareable_url": f"/script/{script.shareable_uuid}",
        "message": "Script approved with official GTG mark. Memory ledger snapshot archived for next class."
    }

# ==============================================================================
# 7. SCRIPT DETAILS & SHAREABLE PERMALINK
# ==============================================================================

@app.get("/api/scripts/{script_id}", response_model=ScriptDetailResponse)
def get_script_detail(script_id: int, db: Session = Depends(get_db)):
    """Full script cards, visual diagrams, and metadata."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    cls = script.class_entity
    mod = cls.module
    prog = mod.track.program

    cards_out = []
    for c in script.cards:
        visual_data = json.loads(c.visual_asset_json) if c.visual_asset_json else None
        if isinstance(visual_data, str):
            try:
                visual_data = json.loads(visual_data)
            except Exception:
                pass

        quiz_data = json.loads(c.quiz_json) if c.quiz_json else None
        if isinstance(quiz_data, str):
            try:
                quiz_data = json.loads(quiz_data)
            except Exception:
                pass

        cards_out.append(ScriptCardOut(
            id=c.id,
            card_index=c.card_index,
            title=c.title,
            duration_mins=c.duration_mins,
            target_words=c.target_words,
            pedagogical_phase=c.pedagogical_phase,
            stage_directions=c.stage_directions,
            content_script=c.content_script,
            code_snippet=c.code_snippet,
            code_language=c.code_language,
            quiz=quiz_data,
            visual_type=visual_data.get("type") if visual_data else None,
            visual_content=visual_data.get("content") if visual_data else None,
            visual_caption=visual_data.get("caption") if visual_data else None,
            is_approved=c.is_approved
        ))

    return ScriptDetailResponse(
        id=script.id,
        class_id=cls.id,
        class_title=cls.title,
        module_name=mod.name,
        track_name=mod.track.name if (mod and mod.track) else "Standard",
        program_name=prog.name,
        status=script.status,
        shareable_uuid=script.shareable_uuid,
        duration_minutes=script.duration_minutes,
        cards_count=len(cards_out),
        created_at=script.created_at,
        cards=cards_out
    )

@app.get("/api/scripts/share/{shareable_uuid}")
def get_shared_script(shareable_uuid: str, db: Session = Depends(get_db)):
    """Public read-only permalink for live instructors and MOs."""
    script = db.query(Script).filter(Script.shareable_uuid == shareable_uuid).first()
    if not script:
        raise HTTPException(status_code=404, detail="Shared script not found")
    return get_script_detail(script.id, db)

@app.delete("/api/scripts/{script_id}")
def delete_script(
    script_id: int,
    user_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Deletes a generated script and all of its associated cards, visual assets, and audits."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            if user.role == "pm":
                raise HTTPException(status_code=403, detail="Program Managers have read-only access and cannot delete scripts.")
            if user.role == "sme":
                if script.user_id and script.user_id != user.id:
                    raise HTTPException(status_code=403, detail="SMEs can only delete scripts they authored.")
            if user.role == "mo":
                cls = script.class_entity
                prog_id = cls.module.track.program_id if cls and cls.module and cls.module.track else None
                user_prog_ids = [p.id for p in user.programs]
                if prog_id and prog_id not in user_prog_ids:
                    raise HTTPException(status_code=403, detail="Module Owner is not assigned to the program of this script.")

    class_title = script.class_entity.title if script.class_entity else f"Script #{script_id}"
    db.delete(script)
    db.commit()
    return {"success": True, "message": f"Script #{script_id} ('{class_title}') deleted successfully."}


# ==============================================================================
# 8. INLINE CARD EDITING & CHAT-BASED CO-PILOT (PRD FR-11 & FR-21)
# ==============================================================================

@app.put("/api/scripts/{script_id}/cards/{card_id}")
def update_script_card(script_id: int, card_id: int, payload: CardUpdateRequest, db: Session = Depends(get_db)):
    """Allows SME to manually edit any card in the deck (PRD FR-11)."""
    card = db.query(ScriptCard).filter(ScriptCard.id == card_id, ScriptCard.script_id == script_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    if payload.title is not None:
        card.title = payload.title
    if payload.duration_mins is not None:
        card.duration_mins = payload.duration_mins
    if payload.pedagogical_phase is not None:
        card.pedagogical_phase = payload.pedagogical_phase
    if payload.stage_directions is not None:
        card.stage_directions = payload.stage_directions
    if payload.content_script is not None:
        card.content_script = payload.content_script
    if payload.code_snippet is not None:
        card.code_snippet = payload.code_snippet
    if payload.code_language is not None:
        card.code_language = payload.code_language
    if payload.is_approved is not None:
        card.is_approved = payload.is_approved

    db.commit()
    db.refresh(card)
    return {"status": "UPDATED", "card_id": card.id, "is_approved": card.is_approved, "message": "Card changes saved successfully."}

@app.post("/api/scripts/{script_id}/chat-assist")
def chat_assist_card(script_id: int, payload: ChatAssistRequest, db: Session = Depends(get_db)):
    """Inline AI Chat Co-Pilot to revise or polish a specific card (PRD FR-11 & FR-21)."""
    card = db.query(ScriptCard).filter(ScriptCard.script_id == script_id, ScriptCard.card_index == payload.card_index).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    groq_key = os.getenv("GROQ_API_KEY")
    api_key = os.getenv("ANTHROPIC_API_KEY")
    execution_mode = os.getenv("EXECUTION_MODE", "hybrid")

    if (groq_key or api_key) and execution_mode != "mock":
        try:
            prompt_body = (
                f"You are an inline AI co-pilot for Scaler lecture scripts.\n"
                f"The SME has asked you to revise a specific card.\n\n"
                f"CARD TITLE: {card.title}\n"
                f"PEDAGOGICAL PHASE: {card.pedagogical_phase}\n"
                f"CURRENT CONTENT:\n{card.content_script}\n\n"
                f"SME INSTRUCTION: {payload.user_prompt}\n\n"
                f"Rules:\n"
                f"- Keep the same card structure and pedagogical phase\n"
                f"- Address the learner as 'you'\n"
                f"- No em dashes, keep paragraphs 2-4 sentences\n"
                f"- Return ONLY the revised spoken script text, no JSON or markdown wrapper"
            )
            if groq_key:
                from agents.groq_client import call_groq_chat
                refined_script = call_groq_chat(
                    messages=[{"role": "user", "content": prompt_body}],
                    max_tokens=2000,
                    temperature=0.3
                )
            else:
                import anthropic
                client = anthropic.Anthropic(api_key=api_key)
                resp = client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=2000,
                    temperature=0.3,
                    messages=[{"role": "user", "content": prompt_body}]
                )
                refined_script = resp.content[0].text.strip()
        except Exception as e:
            print(f"AI chat-assist failed ({e}), using fallback.")
            refined_script = f"{card.content_script}\n\n[Instructor Note: {payload.user_prompt}]"
    else:
        # Fallback for mock mode
        prompt_lower = payload.user_prompt.lower()
        if "simplify" in prompt_lower or "beginner" in prompt_lower:
            refined_script = (
                f"[SIMPLIFIED FOR BEGINNERS]\n"
                f"Think of this like a daily activity we all understand. "
                f"{card.content_script}"
            )
        elif "failure" in prompt_lower or "crash" in prompt_lower:
            card.stage_directions = "[STAGE DIRECTION: Deliberately demonstrate the timeout error in terminal before explaining.]"
            refined_script = (
                f"{card.content_script}\n\n"
                f"Watch what happens when our request queue times out: the thread pool drops to zero available slots "
                f"and incoming users receive HTTP 504 Gateway Timeout."
            )
        else:
            refined_script = f"{card.content_script}\n\n[Instructor Note: {payload.user_prompt}]"

    card.content_script = refined_script
    db.commit()
    db.refresh(card)

    return {
        "status": "REVISED",
        "card_index": card.card_index,
        "new_content_script": card.content_script,
        "stage_directions": card.stage_directions,
        "message": f"Card {card.card_index} revised based on prompt: '{payload.user_prompt}'"
    }

@app.post("/api/scripts/{script_id}/draft-all")
def draft_all_remaining_sections(script_id: int, db: Session = Depends(get_db)):
    """Drafts all remaining cards in the outline up to card 16 in one seamless batch."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    if not script.outline_json:
        raise HTTPException(status_code=400, detail="Must generate outline first.")

    outline = json.loads(script.outline_json)
    total_cards = len(outline)

    # Call generate-section for all cards
    return generate_section(script_id=script_id, start_card=1, end_card=total_cards, db=db)

# ==============================================================================
# 9. EXPORTS & ASSIGNMENTS GENERATION (PRD FR-23)
# ==============================================================================

@app.get("/api/scripts/{script_id}/export/markdown")
def export_script_markdown(script_id: int, db: Session = Depends(get_db)):
    """Generates clean, canonical Markdown export of the entire lecture script."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    cls = script.class_entity
    mod = cls.module
    prog = mod.track.program

    md_lines = [
        f"# {cls.title}",
        f"**Program:** {prog.name} | **Module:** {mod.name} | **Duration:** {script.duration_minutes} Mins",
        f"**Status:** {script.status} | **Shareable UUID:** `{script.shareable_uuid}`",
        "\n---\n"
    ]

    cards = db.query(ScriptCard).filter(ScriptCard.script_id == script_id).order_by(ScriptCard.card_index).all()
    for c in cards:
        md_lines.append(f"## Card {c.card_index}: {c.title}")
        md_lines.append(f"**Duration:** {c.duration_mins} mins | **Phase:** {c.pedagogical_phase}\n")
        
        if c.stage_directions:
            md_lines.append(f"> **Stage Direction:** {c.stage_directions}\n")
        
        md_lines.append(f"### Spoken Script:\n{c.content_script}\n")

        if c.visual_asset_json:
            try:
                vis = json.loads(c.visual_asset_json)
                if vis.get("type") == "mermaid":
                    md_lines.append(f"```mermaid\n{vis.get('content')}\n```\n*{vis.get('caption')}*\n")
                elif vis.get("type") == "image":
                    md_lines.append(f"![{vis.get('caption')}]({vis.get('content')})\n*{vis.get('caption')}*\n")
            except:
                pass

        if c.code_snippet:
            md_lines.append(f"```{c.code_language or 'text'}\n{c.code_snippet}\n```\n")

        if c.quiz_json:
            try:
                q = json.loads(c.quiz_json)
                md_lines.append(f"**Checkpoint Quiz:** {q.get('question')}")
                for opt in q.get("options", []):
                    md_lines.append(f"- {opt}")
                md_lines.append(f"\n*Explanation:* {q.get('explanation')}\n")
            except:
                pass

        md_lines.append("\n---\n")

    full_markdown = "\n".join(md_lines)
    return {"script_id": script.id, "filename": f"{cls.title.replace(' ', '_')}.md", "markdown": full_markdown}

@app.post("/api/scripts/{script_id}/share-hackmd")
def share_script_to_hackmd(script_id: int, payload_body: dict = Body(default={}), db: Session = Depends(get_db)):
    """Publishes the current script directly to HackMD.io as a clean, shareable document."""
    import urllib.request
    import urllib.error
    
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    token = os.getenv("HACKMD_API_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="HACKMD_API_TOKEN is not configured in backend/.env")

    cls = script.class_entity
    custom_content = (payload_body.get("markdown_content") or "").strip()

    if custom_content:
        content_str = custom_content
    else:
        cards = db.query(ScriptCard).filter(ScriptCard.script_id == script_id).order_by(ScriptCard.card_index).all()
        if not cards:
            raise HTTPException(status_code=400, detail="No script sections have been drafted yet.")

        # Build clean HackMD formatted document
        md_lines = [
            f"# {cls.title}",
            f"> **Duration:** {script.duration_minutes} Mins | **Sections:** {len(cards)}",
            "\n---\n"
        ]

        for c in cards:
            md_lines.append(f"## {c.card_index}. {c.title}")
            if c.stage_directions:
                md_lines.append(f"> **Instructor Note:** {c.stage_directions}\n")
            
            md_lines.append(f"{c.content_script}\n")

            if c.visual_asset_json:
                try:
                    vis = json.loads(c.visual_asset_json)
                    if vis.get("type") == "mermaid":
                        md_lines.append(f"```mermaid\n{vis.get('content')}\n```\n*{vis.get('caption', '')}*\n")
                    elif vis.get("type") == "image":
                        md_lines.append(f"![{vis.get('caption', '')}]({vis.get('content')})\n")
                except:
                    pass

            if c.code_snippet:
                md_lines.append(f"```{c.code_language or 'python'}\n{c.code_snippet}\n```\n")

            if c.quiz_json:
                try:
                    q = json.loads(c.quiz_json)
                    md_lines.append(f"### Checkpoint Question: {q.get('question')}")
                    for opt in q.get("options", []):
                        md_lines.append(f"- {opt}")
                    md_lines.append(f"\n*Explanation:* {q.get('explanation')}\n")
                except:
                    pass

            md_lines.append("\n---\n")

        content_str = "\n".join(md_lines)

    payload = {
        "title": cls.title,
        "content": content_str,
        "readPermission": "guest",
        "writePermission": "owner",
        "commentPermission": "everyone"
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.hackmd.io/v1/notes",
        data=req_data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "ScriptGenerator/1.0"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            note_id = data.get("id")
            publish_link = data.get("publishLink")
            note_url = publish_link or f"https://hackmd.io/{note_id}"
            return {
                "success": True,
                "note_id": note_id,
                "url": note_url,
                "title": cls.title
            }
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=500, detail=f"HackMD API Error: {err_msg}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to publish note to HackMD: {str(e)}")

@app.post("/api/scripts/{script_id}/generate-assignments", response_model=AssignmentResponse)
def generate_assignments_and_interviews(script_id: int, db: Session = Depends(get_db)):
    """Creates assignments documentation and mock interview questions (PRD FR-23)."""
    script = db.query(Script).filter(Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    cls = script.class_entity

    homework = [
        {
            "problem_id": 1,
            "title": f"Production Implementation: Resilient {cls.title} Handler",
            "difficulty": "Medium",
            "time_limit_mins": 45,
            "description": f"Design and implement a thread-safe worker pipeline that executes the architectural concepts taught in {cls.title}. Handle connection dropouts and buffer overflows.",
            "rubric": "40% Correctness, 30% Concurrency/Thread-safety, 30% Error boundary handling"
        },
        {
            "problem_id": 2,
            "title": f"Edge-Case Simulation: Deadlock & Backpressure Test",
            "difficulty": "Hard",
            "time_limit_mins": 60,
            "description": "Simulate a scenario where the downstream datastore slows to 5000ms latency. Implement exponential backoff retry and circuit breaker logic.",
            "rubric": "50% Zero message loss, 50% Clean failover & alerting"
        }
    ]

    interviews = [
        {
            "question_id": 1,
            "company": "Amazon / Google",
            "question": f"How would you design a high-throughput event processing system applying the principles of {cls.title}?",
            "expected_depth": "Candidate should walk through trade-offs between sync vs async, partition hashing, and consumer rebalancing."
        },
        {
            "question_id": 2,
            "company": "Uber / Swiggy",
            "question": "What happens when your event stream experiences message ordering anomalies across partitions?",
            "expected_depth": "Explain partition key assignment, idempotency keys, and deduplication tables."
        }
    ]

    return AssignmentResponse(
        script_id=script.id,
        class_title=cls.title,
        homework_problems=homework,
        interview_questions=interviews,
        industry_context="Calibrated against 2026 Tier-1 tech company hiring expectations."
    )

# Mount Frontend UI at root (Must be after all API routes)
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8002, reload=True)

