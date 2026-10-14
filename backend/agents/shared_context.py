"""
Block A: Shared Context Injection Engine for Scaler Script Studio.
Formats the canonical <context> and <context_rules> block injected into every agent:
- Outline Architect Agent
- Spoken Script Drafter Agent
- Multi-Lens Reviewer Panel
- Moderator & Repair Agent
"""

import json
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from models import Class, Module, Track, Program, Script, MemoryLedger


def build_block_a_context(
    db: Session,
    class_id: int,
    duration_minutes: int,
    content_mix_beginner: int,
    code_ratio: int,
    custom_title: Optional[str] = None,
    custom_agendas: Optional[List[str]] = None,
    learning_outcomes: Optional[str] = None,
    api_docs: Optional[str] = None,
    reference_urls: Optional[str] = None,
    additional_resources: Optional[str] = None,
    previous_script_context: Optional[str] = None
) -> str:
    """
    Constructs the canonical Block A shared context and context rules string
    injected into every agent prompt.
    """
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        return ""

    mod = cls.module
    trk = mod.track if mod else None
    prog = trk.program if trk else None

    # Program & Track metadata
    program_name = prog.name if prog else "Academy"
    # Track represents the cohort level: Beginner | Intermediate | Advanced
    track_val = (trk.name if trk else None) or "Intermediate"
    if "beginner" in track_val.lower():
        track_display = "Beginner"
    elif "advanced" in track_val.lower():
        track_display = "Advanced"
    else:
        track_display = "Intermediate"

    module_name = mod.name if mod else "Core Foundations"
    module_tag = mod.module_type if mod else "Core"
    if mod and mod.module_type == "Specialisation":
        module_tag = f"Specialisation: {mod.segment or track_display}"

    effective_title = custom_title or cls.title
    class_type = cls.class_type or "Live"
    
    # Agendas
    if custom_agendas:
        agendas_list = custom_agendas
    elif cls.agendas:
        try:
            agendas_list = json.loads(cls.agendas) if isinstance(cls.agendas, str) else cls.agendas
        except Exception:
            agendas_list = [cls.agendas]
    else:
        agendas_list = []

    # Learning outcomes
    outcomes_str = (learning_outcomes or cls.learning_outcomes or "Comprehensive production mastery.").strip()

    # Tech stack defaults inferred from module / class
    tech_stack = api_docs or "Python 3.12 / Linux x64 / Standard Production Tooling"

    # Look up previous classes or previous module continuity via memory engine
    from agents.memory_engine import retrieve_context_memory, _infer_domain_anchor_from_title
    memory_info = retrieve_context_memory(db, class_id=cls.id, manual_context=additional_resources)
    
    # Running example / analogy resolution (never forced hardcoded default)
    active_running_example = memory_info.get("anchor_analogy") or _infer_domain_anchor_from_title(effective_title, module_name)

    # Past classes in this module (what was taught)
    past_classes = []
    if mod:
        prior_classes = db.query(Class).filter(
            Class.module_id == mod.id,
            Class.sequence_number < cls.sequence_number
        ).order_by(Class.sequence_number.asc()).all()

        for pc in prior_classes:
            ledger = db.query(MemoryLedger).filter(MemoryLedger.class_id == pc.id).first()
            terms = []
            analogy = active_running_example
            if ledger:
                try:
                    terms = json.loads(ledger.terms_mastered) if ledger.terms_mastered else []
                except Exception:
                    terms = []
                analogy = ledger.anchor_analogy or analogy
            else:
                terms = [f"Foundations of {pc.title}"]

            try:
                p_agendas = json.loads(pc.agendas) if pc.agendas else []
            except Exception:
                p_agendas = [pc.agendas]

            past_classes.append({
                "class_number": pc.sequence_number,
                "title": pc.title,
                "agendas": p_agendas,
                "key_terms_introduced": terms,
                "running_example": analogy
            })

    # Cross-module bridge (if inaugural class of a module > 1)
    prev_module_bridge = memory_info.get("previous_module_bridge")
    bridge_section_str = ""
    if prev_module_bridge:
        bridge_section_str = f"""
Previous module continuity bridge:
{json.dumps(prev_module_bridge, indent=2)}
"""

    # Upcoming classes in this module (planned)
    upcoming_classes = []
    if mod:
        next_classes = db.query(Class).filter(
            Class.module_id == mod.id,
            Class.sequence_number > cls.sequence_number
        ).order_by(Class.sequence_number.asc()).all()

        for nc in next_classes:
            try:
                n_agendas = json.loads(nc.agendas) if nc.agendas else []
            except Exception:
                n_agendas = [nc.agendas]

            upcoming_classes.append({
                "class_number": nc.sequence_number,
                "title": nc.title,
                "agenda": n_agendas
            })

    # Previous scripts for this class (reference only)
    prev_scripts_str = previous_script_context or "None available."
    if prev_scripts_str == "None available." and cls:
        approved_script = db.query(Script).filter(
            Script.class_id == cls.id,
            Script.status.in_(["GTG", "Approved", "SME Review"])
        ).order_by(Script.id.desc()).first()
        if approved_script:
            prev_scripts_str = f"Historical Script #{approved_script.id} (Status: {approved_script.status}, Duration: {approved_script.duration_minutes}m)"

    # Approved official docs
    approved_docs = []
    if mod and mod.approved_sources:
        for s in mod.approved_sources.split(","):
            s_clean = s.strip()
            if s_clean:
                approved_docs.append({"url": s_clean, "title": f"Official {module_name} Reference"})
    if reference_urls:
        for u in reference_urls.split(","):
            u_clean = u.strip()
            if u_clean:
                approved_docs.append({"url": u_clean, "title": "SME Specified Documentation"})
    if not approved_docs:
        approved_docs.append({"url": "https://docs.python.org/3/ / Official Language Specs", "title": "Official Language Standard"})

    # Assemble Block A text
    block_a = f"""<context>
Program: {program_name}
Track: {track_display} (Beginner | Intermediate | Advanced)
Module: {module_name}
Module tag: {module_tag}
Class title: {effective_title}
Class type: {class_type}
Duration: {duration_minutes} minutes
Agenda (nested):
{json.dumps(agendas_list, indent=2)}
Learning outcomes: {outcomes_str}
Content mix: {content_mix_beginner}% beginner, {100 - content_mix_beginner}% advanced
Code to content ratio: {code_ratio}% Code / {100 - code_ratio}% Theory & Visuals
Language / platform / version: {tech_stack}
Active running system / analogy: {active_running_example}
{bridge_section_str}
Past classes in this module and program (taught):
{json.dumps(past_classes, indent=2) if past_classes else 'Inaugural Class: None within this module.'}

Upcoming classes (planned):
{json.dumps(upcoming_classes, indent=2) if upcoming_classes else 'Terminal Class in this module.'}

Previous scripts of this class (reference only, may be outdated):
{prev_scripts_str}

Approved official documentation sources:
{json.dumps(approved_docs, indent=2)}

Additional resources: {additional_resources or 'None'}
Golden examples of good scripts: Follow Scaler 6-Part Script Anatomy (Why -> What -> How -> Where -> What breaks)
Program-specific rule overrides: None
</context>

<context_rules>
- Anything in PAST_CLASSES may be referenced as known. Anything not listed there 
  is unknown to learners and must be taught before use.
- Anything in UPCOMING_CLASSES must not be taught here. A one-line forward 
  pointer is allowed.
- PREV_SCRIPTS are for intent and examples only. Never copy outdated APIs, 
  versions, or facts from them; verify against APPROVED_DOCS.
- Never invent artefacts (files, code, datasets, outputs) from earlier classes. 
  Use a placeholder like [[FROM_CLASS: <class title> | <artefact>]].
- PROGRAM_OVERRIDES win over Block B where they conflict.
</context_rules>
"""
    return block_a


BLOCK_B_GOOD_SCRIPT_RULES = """<good_script_rules>
STRUCTURE
S1. A script is a deck of small cards, one idea each. Teaching cards run 
    4 to 10 minutes. A 90-minute class is about 14 to 18 cards.
S2. Order: instructor_note, agenda (nested), then concept / problem / 
    walkthrough cards with quiz cards between them, then faq, then recap.
S3. The recap is one visual mental model.
S4. Cover the whole agenda, add nothing outside it. Card durations sum 
    exactly to DURATION_MIN.

TEACHING SHAPE
T1. Each concept follows Why, What, How, Where, What breaks. Never open with 
    a definition.
T2. Show the obvious approach working at small scale, break it with a 
    quantified failure, then name the fix.
T3. Every claim is followed by its "so what" (a number or a consequence) in 
    the next sentence.
T4. One running example for the whole class, grown visually, with identical 
    names every time. If continuing a module or program, reuse the existing domain 
    and running example from the previous class/module without resetting to a new one.
T5. Bring an idea back in a new form each time (words, then diagram, then 
    quiz, then applied). Never repeat the same form.
T6. Teach a term before using it anywhere, including quizzes, diagrams, and 
    code comments.
T7. Climb from the current level to the target level across cards, and 
    signpost each step up.

ENGAGEMENT
E1. At least 3 predict-before-reveal moments, with the reveal clearly marked.
E2. At least 2 quizzes with tempting wrong options. Explain every wrong option.
E3. Interactions must work online: answers typed in chat, thumbs up/down only 
    for binary checks. No show of hands, no pair work.
E4. Analogies MUST come from learners' everyday daily life (e.g. UPI payments, 
    WhatsApp messaging, grocery/food delivery, train/bus booking, cinema tickets). 
    STRICTLY PROHIBIT esoteric or abstract analogies (e.g., fighter jets, rockets, 
    particle physics, nuclear reactors) that learners cannot personally relate to. 
    Use one grounded analogy per concept, carry it through consistently, and explicitly 
    name where the analogy breaks.

READABILITY
R1. Paragraphs of 2 to 4 sentences. 2 to 4 sub-headings per teaching card.
R2. Callouts: Key, Mistake, Remember, Real-world, Predict. At least one Key 
    per teaching card.
R3. Bold a term only where it is defined.
R4. At least 4 diagrams per class, at least one that branches or compares.
R5. Before/after is shown as two diagram steps. Diagrams have 7 nodes or 
    fewer. Flows show one step per stage.
R6. At least 2 step-by-step traces per class, in code blocks.
R7. No tables, raw HTML, or embedded images inside card text. Visuals are 
    Mermaid blocks or [[VISUAL]] placeholders only.
R8. No em dashes. Vary sentence length. Address the learner as "you".
R9. Depth is not length: add examples, traces, and consequences, never more 
    paragraphs.
R10. Instructor notes are 1 to 2 sentences of delivery hints only.

ACCURACY
A1. Qualify any / every / all / no / never claims about compatibility, safety, 
    or automation by naming the boundary.
A2. If a sequence is simplified, say so in the first sentence of the first card.
A3. Code must run. State platform and version.
A4. Add code or datasets only if the class needs them.
A5. Never invent artefacts from earlier classes; use placeholders.
A6. Every walkthrough step states what to run, what success looks like, and 
    the likely failure. Each walkthrough names at least one failure mode.
A7. Every API or tool taught is cited from current official documentation.
</good_script_rules>

<card_format>
title: <short, clean>
description: <one line>
duration: <seconds>
card_type: <instructor_note | agenda | concept | problem | walkthrough | 
            quiz | faq | recap>
<body in Markdown>

Quiz body:
Question / Choices (numbered, one per line, multi-line outputs written 
with \\n) / Correct: <n> / Why each wrong option is wrong / Explanation

Visual placeholder (inside any body):
[[VISUAL: <id> | type: mermaid | animation | image | intent: <what it must 
show> | nodes: <list, max 7> | step: <n of m if before/after or flow>]]
</card_format>
"""


def build_canonical_agent_prompt(block_a_context: str, specific_task: str) -> str:
    """
    Combines Block A (Shared Context) + Block B (Good Script Rules & Card Format)
    + the Agent's specific task into one unified prompt.
    """
    return f"""{block_a_context}

{BLOCK_B_GOOD_SCRIPT_RULES}

<agent_task>
{specific_task}
</agent_task>
"""

