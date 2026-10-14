"""
Agent 1: Outliner Agent
Proposes card-level outline for a class, grouped into sections.
Handles GTG / Edit / ReThink flows from SME.
Uses Claude Sonnet for LLM-backed outline generation.
"""

import os
import json
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
EXECUTION_MODE = os.getenv("EXECUTION_MODE", "hybrid")


# ── Outliner System Prompt Template ──────────────────────────────────────────

OUTLINER_SYSTEM = """\
You are the Outliner for Scaler's script authoring tool.
{block_a}
{block_b}
"""

OUTLINER_TASK = """\
TASK
Propose a card-level outline for {class_title}. Do not write card content yet.

STEPS
1. Map every agenda item and learning outcome to one or more cards.
2. Dynamically pick an authentic, relatable running system and analogies tailored to this specific class topic.
   The running example and analogy do not have to be Swiggy; they can be ANY relatable everyday system that anyone can immediately understand
   (for example: UPI payment transfers, BookMyShow seat booking, WhatsApp messaging, train/bus reservation, grocery delivery, parcel courier tracking, or ATM withdrawals).
   STRICT REQUIREMENT: The analogy MUST come from everyday real-world life that any student or engineer encounters daily.
   NEVER use esoteric, academic, or abstract analogies (such as rockets, fighter jets, particle accelerators, or nuclear reactors).
   State clearly where each analogy breaks.
3. Plan the difficulty climb for Track: {track} (Beginner | Intermediate | Advanced) to the target outcome,
   honouring the content mix ({beginner_pct}% beginner / {advanced_pct}% advanced).
4. Compare against PAST_CLASSES and UPCOMING_CLASSES and flag overlap.
5. Group cards into sections of 2 to 5 cards each, for section-by-section
   drafting and review.
6. Allocate durations that sum exactly to {duration_min} minutes
   (i.e. {duration_sec} seconds).

OUTPUT (JSON only)
{{
  "assumptions": [string],
  "running_example": string,
  "sections": [{{
    "section_id": string,
    "goal": string,
    "cards": [{{
      "card_id": string, "card_type": string, "title": string,
      "agenda_items": [string], "outcomes": [string],
      "teaching_shape_note": string, "analogy": string|null,
      "predict_moment": boolean, "visuals_planned": [string],
      "duration_sec": number
    }}]
  }}],
  "overlap_flags": [{{
    "card_id": string, "with_class": string, "type": "past" | "upcoming",
    "severity": "recap_ok" | "duplicate" | "teaches_ahead",
    "suggestion": string
  }}],
  "coverage_check": {{"agenda_items_unmapped": [string],
                     "outcomes_unmapped": [string]}},
  "rule_counts_planned": {{"predict_moments": n, "tricky_quizzes": n,
                          "diagrams": n, "traces": n}},
  "total_duration_sec": number
}}
"""

RETHINK_ADDENDUM = """\
The SME chose ReThink.
RETHINK FEEDBACK:
{rethink_feedback}

Produce a STRUCTURALLY DIFFERENT outline, not a reworded one.
Change section grouping, card order, analogy, or running example.
"""

EDIT_ADDENDUM = """\
The SME chose Edit and returned the modified outline below.
EDITED OUTLINE:
{edited_outline}

Validate the edited outline against ALL Block B rules and Block A context.
Return it with any new overlap_flags or coverage_check warnings.
"""


def generate_outline(
    class_title: str,
    agendas: List[str],
    duration_minutes: int,
    content_mix_beginner: int,
    code_ratio: int,
    memory_context: Dict[str, Any],
    block_a_context: Optional[str] = None,
    learning_outcomes: Optional[str] = None,
    additional_resources: Optional[str] = None,
    api_docs: Optional[str] = None,
    reference_urls: Optional[str] = None,
    rethink_feedback: Optional[str] = None,
    edited_outline: Optional[str] = None,
    level: str = "intermediate",
    track: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generates a structured outline grouped into sections.
    Returns the full Outliner JSON schema (sections, overlap_flags, coverage_check, etc.).
    Handles ReThink and Edit flows when feedback is provided.
    """
    has_llm_key = bool(GROQ_API_KEY or ANTHROPIC_API_KEY)
    if not has_llm_key or EXECUTION_MODE == "mock":
        from agents.mock_provider import get_mock_outline
        flat_cards = get_mock_outline(
            class_title=class_title,
            duration_mins=duration_minutes,
            agendas=agendas,
            rethink_feedback=rethink_feedback,
            additional_resources=additional_resources
        )
        return _wrap_flat_cards_as_sections(flat_cards, class_title, duration_minutes)

    try:
        from agents.shared_context import BLOCK_B_GOOD_SCRIPT_RULES

        # Build context header
        if block_a_context:
            context_header = block_a_context
        else:
            context_header = (
                "<context>\n"
                f"Class title: {class_title}\n"
                f"Duration: {duration_minutes} minutes\n"
                f"Agenda (nested): {json.dumps(agendas, indent=2)}\n"
                f"Learning outcomes: {learning_outcomes or 'Comprehensive mastery.'}\n"
                f"Content mix: {content_mix_beginner}% beginner, "
                f"{100 - content_mix_beginner}% advanced\n"
                f"Code to content ratio: {code_ratio}% Code\n"
                "</context>"
            )

        system_prompt = OUTLINER_SYSTEM.format(
            block_a=context_header,
            block_b=BLOCK_B_GOOD_SCRIPT_RULES
        )

        task_prompt = OUTLINER_TASK.format(
            class_title=class_title,
            track=track or "Core Track",
            level=level,
            beginner_pct=content_mix_beginner,
            advanced_pct=100 - content_mix_beginner,
            duration_min=duration_minutes,
            duration_sec=duration_minutes * 60
        )

        # Append ReThink or Edit addendum if applicable
        if rethink_feedback:
            task_prompt += "\n\n" + RETHINK_ADDENDUM.format(
                rethink_feedback=rethink_feedback
            )
        elif edited_outline:
            task_prompt += "\n\n" + EDIT_ADDENDUM.format(
                edited_outline=edited_outline
            )

        # Use Groq API as primary engine
        if GROQ_API_KEY:
            from agents.groq_client import call_groq_chat
            content_text = call_groq_chat(
                system=system_prompt,
                messages=[{"role": "user", "content": task_prompt}],
                max_tokens=6000,
                temperature=0.3
            )
        else:
            import anthropic
            client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=6000,
                temperature=0.3,
                system=system_prompt,
                messages=[{"role": "user", "content": task_prompt}]
            )
            content_text = response.content[0].text.strip()
        if "```json" in content_text:
            content_text = content_text.split("```json")[1].split("```")[0].strip()
        elif "```" in content_text:
            content_text = content_text.split("```")[1].split("```")[0].strip()

        outline = json.loads(content_text)
        return _normalize_outline_duration(outline, duration_minutes)

    except Exception as e:
        print(f"Warning: Outliner agent failed ({e}). Falling back to dynamic mock.")
        from agents.mock_provider import get_mock_outline
        flat_cards = get_mock_outline(
            class_title=class_title,
            duration_mins=duration_minutes,
            agendas=agendas,
            rethink_feedback=rethink_feedback,
            additional_resources=additional_resources
        )
        return _wrap_flat_cards_as_sections(flat_cards, class_title, duration_minutes)


def _normalize_outline_duration(outline: Dict[str, Any], target_duration_mins: int) -> Dict[str, Any]:
    """
    Enforces that card durations in the outline strictly sum to target_duration_mins (in seconds).
    If LLM drifted, scales cards proportionally and eliminates rounding remainders on the main concept card.
    """
    sections = outline.get("sections", [])
    all_cards = []
    for s in sections:
        for c in s.get("cards", []):
            all_cards.append(c)

    if not all_cards:
        return outline

    target_total_sec = int(target_duration_mins * 60)
    current_sec = sum(c.get("duration_sec", 300) for c in all_cards)

    if current_sec <= 0:
        base_sec = target_total_sec // len(all_cards)
        for c in all_cards:
            c["duration_sec"] = base_sec
        current_sec = sum(c["duration_sec"] for c in all_cards)

    # Scale proportionally
    scaled_sum = 0
    for c in all_cards:
        raw_scaled = int(round((c.get("duration_sec", 300) / current_sec) * target_total_sec))
        # Ensure at least 120 seconds (2 mins) per card
        c["duration_sec"] = max(120, raw_scaled)
        scaled_sum += c["duration_sec"]

    # Reconcile exact difference onto the largest/middle card
    diff = target_total_sec - scaled_sum
    if diff != 0:
        mid_card = all_cards[len(all_cards) // 2]
        mid_card["duration_sec"] = max(120, mid_card["duration_sec"] + diff)

    outline["total_duration_sec"] = target_total_sec
    return outline


def _wrap_flat_cards_as_sections(
    flat_cards: List[Dict[str, Any]],
    class_title: str,
    duration_minutes: int
) -> Dict[str, Any]:
    """Wraps legacy flat card list into the new section-based Outliner schema."""
    sections = []
    section_cards = []
    section_idx = 1

    for i, card in enumerate(flat_cards):
        card_entry = {
            "card_id": f"C{i+1:02d}",
            "card_type": _phase_to_card_type(card.get("pedagogical_phase", "concept")),
            "title": card.get("title", f"Card {i+1}"),
            "agenda_items": [card.get("key_concept", "")],
            "outcomes": [],
            "teaching_shape_note": card.get("key_concept") or card.get("concept") or card.get("title", ""),
            "analogy": None,
            "predict_moment": card.get("pedagogical_phase") == "Quiz",
            "visuals_planned": [card.get("visual_type", "none")] if card.get("visual_type", "none") != "none" else [],
            "duration_sec": int(card.get("duration_mins", 5.0) * 60)
        }
        section_cards.append(card_entry)

        # Group into sections of 3-4 cards
        if len(section_cards) >= 4 or i == len(flat_cards) - 1:
            sections.append({
                "section_id": f"S{section_idx:02d}",
                "goal": f"Section {section_idx}: {section_cards[0]['title']} through {section_cards[-1]['title']}",
                "cards": section_cards
            })
            section_cards = []
            section_idx += 1

    total_sec = sum(
        c["duration_sec"]
        for s in sections
        for c in s["cards"]
    )

    from agents.memory_engine import _infer_domain_anchor_from_title
    running_example = _infer_domain_anchor_from_title(class_title)

    return {
        "assumptions": [f"Outline for {class_title}"],
        "running_example": running_example,
        "sections": sections,
        "overlap_flags": [],
        "coverage_check": {"agenda_items_unmapped": [], "outcomes_unmapped": []},
        "rule_counts_planned": {
            "predict_moments": 3,
            "tricky_quizzes": 2,
            "diagrams": 4,
            "traces": 2
        },
        "total_duration_sec": total_sec
    }


def _phase_to_card_type(phase: str) -> str:
    """Maps legacy pedagogical_phase to card_type enum."""
    mapping = {
        "Instructor Note": "instructor_note",
        "Metadata & Lock": "instructor_note",
        "Agenda": "agenda",
        "Concept": "concept",
        "Everyday Analogy": "concept",
        "Why/What": "concept",
        "Failure Mode": "problem",
        "Code Along": "walkthrough",
        "Code Trace": "walkthrough",
        "Tracing": "walkthrough",
        "Quiz": "quiz",
        "FAQ": "faq",
        "Recap": "recap",
    }
    return mapping.get(phase, "concept")
