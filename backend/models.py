import datetime
import uuid
from typing import List, Optional
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, Float, DateTime, ForeignKey, Table
)
from sqlalchemy.orm import relationship
from database import Base

user_programs = Table(
    "user_programs",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("program_id", Integer, ForeignKey("programs.id", ondelete="CASCADE"), primary_key=True)
)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    role = Column(String(50), nullable=False)  # "sme", "mo", "pm", "admin"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    programs = relationship("Program", secondary=user_programs, back_populates="users")

class Program(Base):
    __tablename__ = "programs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    description = Column(Text, nullable=True)

    tracks = relationship("Track", back_populates="program", cascade="all, delete-orphan")
    users = relationship("User", secondary=user_programs, back_populates="programs")

class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True, index=True)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=False)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False)

    program = relationship("Program", back_populates="tracks")
    modules = relationship("Module", back_populates="track", cascade="all, delete-orphan")

class Module(Base):
    __tablename__ = "modules"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False)
    sequence_order = Column(Integer, default=1)
    is_locked = Column(Boolean, default=True)
    module_type = Column(String(50), default="Core")
    approved_sources = Column(Text, nullable=True)
    # FR-3 / FR-4 / FR-6: plan provenance, review lifecycle, and ownership
    plan_source = Column(String(20), default="manual")      # manual | syllabus | both
    plan_status = Column(String(20), default="Locked")      # Draft | In Review | Locked
    owner_name = Column(String(255), nullable=True)          # assigned SME or Module Owner

    track = relationship("Track", back_populates="modules")
    classes = relationship("Class", back_populates="module", cascade="all, delete-orphan")
    memory_ledgers = relationship("MemoryLedger", back_populates="module", cascade="all, delete-orphan")

class Class(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    module_id = Column(Integer, ForeignKey("modules.id"), nullable=False)
    sequence_number = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    duration_minutes = Column(Integer, default=90)
    agendas = Column(Text, nullable=False)
    learning_outcomes = Column(Text, nullable=True)
    class_type = Column(String(50), default="Live")
    module_type = Column(String(50), default="Core")
    content_change_pct = Column(Integer, default=0)

    module = relationship("Module", back_populates="classes")
    scripts = relationship("Script", back_populates="class_entity", cascade="all, delete-orphan")
    memory_ledgers = relationship("MemoryLedger", back_populates="class_entity", cascade="all, delete-orphan")

class Script(Base):
    __tablename__ = "scripts"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False)
    shareable_uuid = Column(String(64), unique=True, default=lambda: str(uuid.uuid4()))
    status = Column(String(50), default="Not Started")
    duration_minutes = Column(Integer, default=90)
    content_mix_beginner = Column(Integer, default=70)
    content_mix_advanced = Column(Integer, default=30)
    code_ratio = Column(Integer, default=20)
    additional_resources = Column(Text, nullable=True)
    api_docs = Column(Text, nullable=True)
    reference_urls = Column(Text, nullable=True)
    previous_script_context = Column(Text, nullable=True)
    outline_json = Column(Text, nullable=True)
    outline_approved = Column(Boolean, default=False)
    custom_agendas = Column(Text, nullable=True)
    custom_class_title = Column(String(255), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    sme_name = Column(String(255), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approved_by_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    user = relationship("User")
    class_entity = relationship("Class", back_populates="scripts")
    cards = relationship("ScriptCard", back_populates="script", cascade="all, delete-orphan")
    audits = relationship("ReviewAudit", back_populates="script", cascade="all, delete-orphan")

class ScriptCard(Base):
    __tablename__ = "script_cards"

    id = Column(Integer, primary_key=True, index=True)
    script_id = Column(Integer, ForeignKey("scripts.id"), nullable=False)
    card_index = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    duration_mins = Column(Float, nullable=False)
    target_words = Column(Integer, default=450)
    pedagogical_phase = Column(String(50), default="Concept")
    stage_directions = Column(Text, nullable=True)
    content_script = Column(Text, nullable=False)
    code_snippet = Column(Text, nullable=True)
    code_language = Column(String(50), nullable=True)
    quiz_json = Column(Text, nullable=True)
    visual_asset_json = Column(Text, nullable=True)
    is_approved = Column(Boolean, default=False)

    script = relationship("Script", back_populates="cards")
    visual_assets = relationship("VisualAsset", back_populates="card", cascade="all, delete-orphan")

class MemoryLedger(Base):
    __tablename__ = "memory_ledgers"

    id = Column(Integer, primary_key=True, index=True)
    module_id = Column(Integer, ForeignKey("modules.id"), nullable=False)
    class_id = Column(Integer, ForeignKey("classes.id"), nullable=False)
    terms_mastered = Column(Text, nullable=True)
    code_abstractions = Column(Text, nullable=True)
    anchor_analogy = Column(String(255), nullable=True)
    cliffhanger = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    module = relationship("Module", back_populates="memory_ledgers")
    class_entity = relationship("Class", back_populates="memory_ledgers")

class ReviewAudit(Base):
    __tablename__ = "review_audits"

    id = Column(Integer, primary_key=True, index=True)
    script_id = Column(Integer, ForeignKey("scripts.id"), nullable=False)
    lens_name = Column(String(100), nullable=False)
    reviewer_persona = Column(String(50), nullable=False)
    findings_json = Column(Text, nullable=False)
    score = Column(Float, default=10.0)
    passed = Column(Boolean, default=True)
    retry_iteration = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    script = relationship("Script", back_populates="audits")

class VisualAsset(Base):
    __tablename__ = "visual_assets"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("script_cards.id"), nullable=False)
    asset_type = Column(String(50), nullable=False)
    content_data = Column(Text, nullable=False)
    caption = Column(String(255), nullable=True)
    figure_label = Column(String(50), nullable=True)

    card = relationship("ScriptCard", back_populates="visual_assets")

class UserActivity(Base):
    __tablename__ = "user_activities"

    id = Column(Integer, primary_key=True, index=True)
    user_name = Column(String(255), nullable=False)
    user_role = Column(String(50), nullable=True)
    action_type = Column(String(100), nullable=False) # e.g. "Script Initialized", "GTG Approved", "Class Created", "Login"
    description = Column(Text, nullable=False)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

