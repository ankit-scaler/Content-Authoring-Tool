"""
Agent 2: Writer Agent
Writes cards section-by-section from the approved outline.
Maintains a term register for continuity across sections.
Supports inline assist mode for targeted rewrites.
Uses Claude Sonnet for LLM-backed card generation.
"""

import os
import json
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
EXECUTION_MODE = os.getenv("EXECUTION_MODE", "hybrid")


# ── Writer System Prompt Template ────────────────────────────────────────────

WRITER_SYSTEM = """\
You are the Writer for Scaler's script authoring tool.
{block_a}
{block_b}
"""

WRITER_SECTION_TASK = """\
INPUTS
Approved outline: {approved_outline}
Section to write now: {section_id}
Already approved sections (for continuity): {approved_sections}
Terms already introduced in this script: {term_register}

TASK
Write every card in {section_id}, following the outline and card_format exactly.

CRITICAL PEDAGOGICAL REQUIREMENTS:
- DO NOT just provide dry theory! Every concept card must weave together explanations, visual models, code/steps, and interactive checkpoint moments.
- VISUAL ASSETS (MANDATORY): For every major concept, state transition, or system architecture card, populate "visual_requests" with at least one visual request (type: "mermaid" for architecture/flowcharts, "animation" for dynamic step-by-step state changes, or "image" for high-impact conceptual diagrams).
- CHECKPOINT QUIZZES: At least 2 cards in each topic deck (or cards flagged as quiz/checkpoint) MUST have a fully structured "quiz_json" with:
  {{
    "question": "Clear question testing intuition or boundary condition",
    "options": ["A) option 1", "B) option 2", "C) option 3", "D) option 4"],
    "correct_option_index": 0,
    "explanation": "Detailed pedagogical explanation of why the correct option wins and why common distractors fail."
  }}
- INTERACTIVE ANIMATIONS & DIAGRAMS: In body_markdown, always embed corresponding visual marker tags such as:
  `[[VISUAL: id_here | type: animation | intent: step-by-step animation of buffer filling | nodes: Empty,Half,Full,Spill]]` or Mermaid diagram blocks so instructors and learners see rich visual explanations instead of plain walls of text.

REFERENCES
- Use APPROVED_DOCS first for every API, command, flag, or tool you teach.
- If an approved source does not cover something, you may search the web.
  Label each such source "UNVERIFIED: needs SME validation".
- Never state a version-specific fact without a source.

CONTINUITY
- Keep running example names identical to APPROVED_SECTIONS.
- Use ONLY grounded everyday daily-life analogies (UPI, WhatsApp, grocery/food delivery, train/movie booking).
  STRICTLY NEVER use abstract/esoteric analogies like fighter jets, rockets, or particle physics.
- Do not reuse a form (words, diagram, quiz, applied) already used for the same idea.
- Signpost the step up when difficulty rises.

OUTPUT
Return ONLY valid JSON with this structure:
{{
  "cards": [
    {{
      "card_id": string,
      "card_type": "instructor_note | agenda | concept | problem | walkthrough | quiz | faq | recap",
      "title": string,
      "description": string,
      "duration_sec": number,
      "body_markdown": string,
      "instructor_note": string,
      "code_snippet": string or null,
      "code_language": string or null,
      "quiz_json": {{ "question": string, "options": [string], "correct_option_index": int, "explanation": string }} or null
    }}
  ],
  "references": [{{
    "url": string, "title": string, "retrieved": "YYYY-MM-DD",
    "approved": boolean, "used_in": [card_id]
  }}],
  "new_terms": [{{"term": string, "defined_in": "card_id"}}],
  "visual_requests": [{{
    "id": string, "type": "mermaid | animation | image",
    "intent": string, "nodes": [string], "card_id": string
  }}],
  "self_check": {{
    "rules_met": [rule_id],
    "rules_at_risk": [{{"rule": "rule_id", "reason": string}}]
  }}
}}
"""

INLINE_ASSIST_TASK = """\
INLINE ASSIST MODE
Rewrite ONLY the selected text to satisfy the request and all Block B rules.
Return ONLY the replacement text, nothing else.

REQUEST: {inline_request}
SELECTED TEXT:
{selected_text}
"""


def write_section(
    section_id: str,
    approved_outline: Dict[str, Any],
    approved_sections: List[Dict[str, Any]],
    term_register: List[Dict[str, str]],
    block_a_context: Optional[str] = None,
    class_title: str = "",
    memory_context: Optional[Dict[str, Any]] = None,
    content_mix_beginner: int = 65,
    code_ratio: int = 50
) -> Dict[str, Any]:
    """
    Writes all cards for a given section_id from the approved outline.
    Returns cards + references + new_terms + visual_requests + self_check.
    """
    has_llm_key = bool(GROQ_API_KEY or ANTHROPIC_API_KEY)
    if not has_llm_key or EXECUTION_MODE == "mock":
        return _mock_section_output(section_id, approved_outline, class_title)

    try:
        from agents.shared_context import BLOCK_B_GOOD_SCRIPT_RULES

        # Build context
        if block_a_context:
            context_header = block_a_context
        else:
            anchor = (memory_context or {}).get("anchor_analogy", "Swiggy")
            context_header = (
                "<context>\n"
                f"Class title: {class_title}\n"
                f"Analogy: {anchor}\n"
                f"Audience mix: {content_mix_beginner}% beginner, "
                f"{100 - content_mix_beginner}% advanced\n"
                f"Code ratio: {code_ratio}% Code\n"
                "</context>"
            )

        system_prompt = WRITER_SYSTEM.format(
            block_a=context_header,
            block_b=BLOCK_B_GOOD_SCRIPT_RULES
        )

        # Compact approved sections to just card_ids and titles for context
        approved_summary = []
        for sec in approved_sections:
            for card in sec.get("cards", []):
                approved_summary.append({
                    "card_id": card.get("card_id"),
                    "title": card.get("title"),
                    "card_type": card.get("card_type")
                })

        task_prompt = WRITER_SECTION_TASK.format(
            approved_outline=json.dumps(approved_outline, indent=2),
            section_id=section_id,
            approved_sections=json.dumps(approved_summary, indent=2) if approved_summary else "None (first section)",
            term_register=json.dumps(term_register) if term_register else "[]"
        )

        if GROQ_API_KEY:
            from agents.groq_client import call_groq_chat
            content_text = call_groq_chat(
                system=system_prompt,
                messages=[{"role": "user", "content": task_prompt}],
                max_tokens=8000,
                temperature=0.2
            )
        else:
            import anthropic
            client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=8000,
                temperature=0.2,
                system=system_prompt,
                messages=[{"role": "user", "content": task_prompt}]
            )
            content_text = response.content[0].text.strip()

        raw_str = content_text.strip()
        if "```json" in raw_str:
            raw_str = raw_str.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in raw_str:
            raw_str = raw_str.split("```", 1)[1].split("```", 1)[0].strip()

        # If model added conversational prefix before {
        if "{" in raw_str and "}" in raw_str:
            start_idx = raw_str.find("{")
            end_idx = raw_str.rfind("}") + 1
            raw_str = raw_str[start_idx:end_idx]

        result = json.loads(raw_str)
        return result

    except Exception as e:
        print(f"Warning: Writer agent failed ({e}). Falling back to mock.")
        return _mock_section_output(section_id, approved_outline, class_title)


def inline_assist(
    selected_text: str,
    inline_request: str,
    block_a_context: Optional[str] = None
) -> str:
    """
    Rewrites a selected text snippet per the SME's inline request.
    Returns only the replacement text.
    """
    has_llm_key = bool(GROQ_API_KEY or ANTHROPIC_API_KEY)
    if not has_llm_key or EXECUTION_MODE == "mock":
        return selected_text  # No-op in mock mode

    try:
        from agents.shared_context import BLOCK_B_GOOD_SCRIPT_RULES

        system_prompt = WRITER_SYSTEM.format(
            block_a=block_a_context or "",
            block_b=BLOCK_B_GOOD_SCRIPT_RULES
        )

        task_prompt = INLINE_ASSIST_TASK.format(
            inline_request=inline_request,
            selected_text=selected_text
        )

        if GROQ_API_KEY:
            from agents.groq_client import call_groq_chat
            return call_groq_chat(
                system=system_prompt,
                messages=[{"role": "user", "content": task_prompt}],
                max_tokens=2000,
                temperature=0.2
            )
        else:
            import anthropic
            client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2000,
                temperature=0.2,
                system=system_prompt,
                messages=[{"role": "user", "content": task_prompt}]
            )
            return response.content[0].text.strip()

    except Exception as e:
        print(f"Warning: Inline assist failed ({e}).")
        return selected_text


# ── Legacy API compatibility ─────────────────────────────────────────────────
# These functions are imported by workflow_graph.py and main.py

def generate_outline(
    class_title: str,
    agendas: List[str],
    duration_minutes: int,
    content_mix_beginner: int,
    code_ratio: int,
    memory_context: Dict[str, Any],
    additional_resources: Optional[str] = None,
    learning_outcomes: Optional[str] = None,
    api_docs: Optional[str] = None,
    reference_urls: Optional[str] = None,
    block_a_context: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Legacy wrapper: calls Outliner agent and flattens sections into a card list
    for backward-compatible pipeline usage.
    """
    from agents.outliner import generate_outline as outliner_generate
    outline = outliner_generate(
        class_title=class_title,
        agendas=agendas,
        duration_minutes=duration_minutes,
        content_mix_beginner=content_mix_beginner,
        code_ratio=code_ratio,
        memory_context=memory_context,
        block_a_context=block_a_context,
        learning_outcomes=learning_outcomes,
        additional_resources=additional_resources,
        api_docs=api_docs,
        reference_urls=reference_urls
    )
    # Flatten sections into a flat card list for legacy consumers
    flat_cards = []
    idx = 1
    for section in outline.get("sections", []):
        for card in section.get("cards", []):
            flat_cards.append({
                "card_index": idx,
                "card_id": card.get("card_id", f"C{idx:02d}"),
                "title": card.get("title", f"Card {idx}"),
                "duration_mins": round(card.get("duration_sec", 300) / 60.0, 1),
                "card_type": card.get("card_type", "concept"),
                "pedagogical_phase": card.get("card_type", "concept").replace("_", " ").title(),
                "key_concept": ", ".join(card.get("agenda_items", [])),
                "visual_type": card.get("visuals_planned", ["none"])[0] if card.get("visuals_planned") else "none",
                "section_id": section.get("section_id"),
            })
            idx += 1
    return flat_cards


def draft_card_batch(
    class_title: str,
    outline_cards: List[Dict[str, Any]],
    batch_start_idx: int,
    batch_end_idx: int,
    memory_context: Dict[str, Any],
    code_ratio: int,
    content_mix_beginner: int,
    block_a_context: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Legacy wrapper: drafts a batch of cards using the new section-based Writer.
    Groups the batch into a pseudo-section and calls write_section.
    """
    batch_cards = outline_cards[batch_start_idx - 1 : batch_end_idx]

    # Build a pseudo-outline for the batch
    pseudo_outline = {
        "sections": [{
            "section_id": f"BATCH_{batch_start_idx}_{batch_end_idx}",
            "goal": f"Cards {batch_start_idx} to {batch_end_idx}",
            "cards": [
                {
                    "card_id": c.get("card_id", f"C{c.get('card_index', i+1):02d}"),
                    "card_type": c.get("card_type", c.get("pedagogical_phase", "concept")),
                    "title": c.get("title", f"Card {i+1}"),
                    "agenda_items": [c.get("key_concept", "")],
                    "outcomes": [],
                    "teaching_shape_note": "Why -> What -> How -> Where -> What breaks",
                    "analogy": None,
                    "predict_moment": False,
                    "visuals_planned": [c.get("visual_type", "none")] if c.get("visual_type", "none") != "none" else [],
                    "duration_sec": int(c.get("duration_mins", 5.0) * 60)
                }
                for i, c in enumerate(batch_cards)
            ]
        }]
    }

    result = write_section(
        section_id=f"BATCH_{batch_start_idx}_{batch_end_idx}",
        approved_outline=pseudo_outline,
        approved_sections=[],
        term_register=[],
        block_a_context=block_a_context,
        class_title=class_title,
        memory_context=memory_context,
        content_mix_beginner=content_mix_beginner,
        code_ratio=code_ratio
    )

    # Convert section output back to legacy card format
    drafted = []
    for card in result.get("cards", []):
        drafted.append({
            "card_index": batch_start_idx + len(drafted),
            "card_id": card.get("card_id"),
            "title": card.get("title", ""),
            "card_type": card.get("card_type", "concept"),
            "duration_mins": round(card.get("duration_sec", 300) / 60.0, 1),
            "pedagogical_phase": card.get("card_type", "concept").replace("_", " ").title(),
            "instructor_note": card.get("instructor_note", ""),
            "stage_directions": "",
            "content_script": card.get("body_markdown", ""),
            "code_snippet": card.get("code_snippet"),
            "code_language": card.get("code_language"),
            "mermaid_syntax": None,
            "quiz_json": card.get("quiz_json"),
        })
    return drafted


# ── Mock helpers ─────────────────────────────────────────────────────────────

def _mock_section_output(
    section_id: str,
    approved_outline: Dict[str, Any],
    class_title: str
) -> Dict[str, Any]:
    """Generates mock Writer output for a section."""
    from agents.mock_provider import get_mock_cards

    mock_cards = get_mock_cards(class_title)

    # Find the target section – tolerate sec_1/S01/section-1 naming mismatches
    target_section = None
    sections = approved_outline.get("sections", [])
    for section in sections:
        if section.get("section_id") == section_id:
            target_section = section
            break
    if not target_section:
        # Fallback: match by 1-based index embedded in section_id (e.g. "sec_1" → index 1, "S01" → index 1)
        import re
        m = re.search(r"(\d+)", section_id or "")
        if m:
            idx = int(m.group(1)) - 1
            if 0 <= idx < len(sections):
                target_section = sections[idx]

    cards_out = []
    if target_section:
        for idx, card_meta in enumerate(target_section.get("cards", [])):
            card_id = card_meta.get("card_id", f"C{idx+1:02d}")
            c_type = card_meta.get("card_type", "concept")
            c_title = card_meta.get("title", f"Card {card_id}")
            concept = card_meta.get("teaching_shape_note") or (card_meta.get("agenda_items") or [""])[0] or c_title
            
            # Match against rich template if available, otherwise generate high quality spoken dialogue
            template_match = None
            for mc in mock_cards:
                if mc.get("title", "").lower() in c_title.lower() or c_title.lower() in mc.get("title", "").lower():
                    template_match = mc
                    break

            if template_match:
                script_body = template_match.get("content_script", "")
                stage_cue = template_match.get("stage_directions", "Pace delivery clearly and check learner responses.")
                code_snippet = template_match.get("code_snippet")
                code_lang = template_match.get("code_language")
                quiz_data = template_match.get("quiz_json")
            else:
                # Synthesize pedagogical script based on card type
                if "instructor" in c_title.lower() or c_type == "instructor_note":
                    stage_cue = f"[CAMERA ON INSTRUCTOR. Do not share screen yet. Frame 90-minute expectations for {class_title}.]"
                    script_body = (
                        f"Welcome everyone to today's deep-dive session on {class_title}. "
                        "Before we jump into code or terminal sessions, let us set our expectations for the next 90 minutes. "
                        "We will move from the foundational architectural mechanics to a live, production-grade implementation. "
                        "Keep your chat box open, ask questions whenever a concept feels ambiguous, and pay close attention to the failure patterns we highlight."
                    )
                    code_snippet, code_lang, quiz_data = None, None, None
                elif "agenda" in c_title.lower() or "roadmap" in c_title.lower():
                    stage_cue = "[PROJECT ROADMAP ON SCREEN. Point to the three learning phases.]"
                    script_body = (
                        f"Here is our technical roadmap for {class_title}. We break this journey into three distinct phases: "
                        "First, we analyze the naive implementation and why it collapses under load. "
                        "Second, we design the resilient decoupled pattern step-by-step. "
                        "Finally, we implement the solution in code and inject simulated failure modes to prove its robustness."
                    )
                    code_snippet, code_lang, quiz_data = None, None, None
                elif "analogy" in c_title.lower():
                    stage_cue = "[USE WHITEBOARD. Sketch the real-world operational flow and highlight the physical bottleneck.]"
                    script_body = (
                        f"To build an intuition for {c_title}, let us consider an everyday analogy. "
                        "Imagine an order management counter during peak rush hour where a single clerk tries to take orders, "
                        "verify payment, and hand over packages all at once. A single delayed customer blocks the entire queue. "
                        "In production systems, synchronous blocking operations produce the exact same deadlock. "
                        "By introducing an asynchronous buffer, downstream processing proceeds smoothly without starving the front counter."
                    )
                    code_snippet, code_lang, quiz_data = None, None, None
                elif "quiz" in c_title.lower() or c_type == "quiz":
                    stage_cue = "[LAUNCH POLL IN CHAT. Give learners 45 seconds to submit answers before analyzing distractors.]"
                    script_body = (
                        f"Let us test our intuition on {c_title}. Look closely at the question on your screen. "
                        "Think about what happens at the boundary between client requests and worker threads. "
                        "Select your answer, and then we will examine why the common distractors fail."
                    )
                    code_snippet, code_lang = None, None
                    quiz_data = {
                        "question": f"In {class_title}, what is the primary risk of an unbuffered synchronous request pipeline?",
                        "options": [
                            "A) Operating system thread pool exhaustion and cascading HTTP 504 timeouts",
                            "B) Immediate file descriptor corruption on client disk",
                            "C) Sub-millisecond CPU register cache thrashing",
                            "D) DNS query packet loop at gateway boundary"
                        ],
                        "correct_option_index": 0,
                        "explanation": "Correct answer is A. Synchronous blocking ties up worker threads, exhausting pool capacity and triggering cascading timeouts across upstream services."
                    }
                elif "code" in c_title.lower() or c_type in ["code", "code_along"]:
                    stage_cue = f"[SWITCH TO IDE. Live code the handler for {c_title} and execute the unit test suite.]"
                    script_body = (
                        f"Let us look at the code for {c_title}. Notice how we structure the handler: "
                        "we validate the payload immediately at the boundary, delegate the long-running computation "
                        "to our worker queue, and return an immediate acknowledgment to the caller. "
                        "Let us run this locally and inspect the sub-5ms latency profile."
                    )
                    code_snippet = (
                        f"# Production Implementation for {class_title}\n"
                        "from typing import Dict, Any\n"
                        "import time\n\n"
                        "def handle_workload(payload: Dict[str, Any]) -> Dict[str, Any]:\n"
                        "    # Validate payload integrity\n"
                        "    if not payload.get('id'):\n"
                        "        raise ValueError('Invalid payload identifier')\n\n"
                        "    # Non-blocking async dispatch\n"
                        "    task_id = f'task_{payload[\"id\"]}_{int(time.time())}'\n"
                        "    return {'status': 'ACCEPTED', 'task_id': task_id}\n"
                    )
                    code_lang = "python"
                    quiz_data = None
                else:
                    stage_cue = f"[SHOW ARCHITECTURE SLIDE. Emphasize state transitions and boundary guarantees for {c_title}.]"
                    script_body = (
                        f"Now let us examine {c_title}. When we look at {concept}, the central challenge is ensuring predictability. "
                        "If our components are tightly coupled, any downstream latency ripples backwards through the entire call graph. "
                        "By defining strict boundaries and fail-fast invariants, each node maintains isolated operational safety even under peak load."
                    )
                    code_snippet, code_lang, quiz_data = None, None, None

            cards_out.append({
                "card_id": card_id,
                "card_type": c_type,
                "title": c_title,
                "description": f"Structured card for {class_title}",
                "duration_sec": card_meta.get("duration_sec", 300),
                "body_markdown": script_body,
                "instructor_note": stage_cue,
                "code_snippet": code_snippet,
                "code_language": code_lang,
                "quiz_json": quiz_data
            })
    else:
        # Fallback: use first few mock cards
        for i, mc in enumerate(mock_cards[:4]):
            cards_out.append({
                "card_id": f"C{i+1:02d}",
                "card_type": "concept",
                "title": mc.get("title", f"Card {i+1}"),
                "description": f"Auto-drafted card for {class_title}",
                "duration_sec": int(mc.get("duration_mins", 5.0) * 60),
                "body_markdown": mc.get("content_script", f"Lecture dialogue for {mc.get('title')}"),
                "instructor_note": mc.get("stage_directions", mc.get("instructor_note", "")),
                "code_snippet": mc.get("code_snippet"),
                "code_language": mc.get("code_language"),
                "quiz_json": mc.get("quiz_json")
            })

    return {
        "cards": cards_out,
        "references": [],
        "new_terms": [],
        "visual_requests": [],
        "self_check": {
            "rules_met": ["S1", "S2", "S4", "T1", "R1", "R8"],
            "rules_at_risk": []
        }
    }
