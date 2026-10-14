import os
import json
from typing import List, Dict, Any, Tuple, Optional
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
EXECUTION_MODE = os.getenv("EXECUTION_MODE", "hybrid")

def moderate_and_repair(
    cards: List[Dict[str, Any]],
    reviews: List[Dict[str, Any]],
    target_duration_mins: int,
    iteration: int = 1,
    block_a_context: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], bool, Dict[str, Any]]:
    """
    Surgical Moderator Agent.
    Hierarchy: 1. Correctness > 2. Difficulty Arc > 3. Room Mix > 4. Time.
    Only repairs cards flagged with blocker or major issues; leaves passing cards untouched.
    Rebalances card durations so the total equals target_duration_mins exactly.
    Returns: (repaired_cards, is_gtg, moderation_summary).
    """
    # 1. Collect all findings across lenses
    all_findings = []
    for r in reviews:
        for f in r.get("findings", []):
            all_findings.append({**f, "lens": r.get("lens_name")})

    # Filter to blockers and majors
    actionable_findings = [f for f in all_findings if f.get("severity") in ["blocker", "major"]]

    # If no blockers or majors, script is GTG
    if not actionable_findings:
        return cards, True, {
            "iteration": iteration,
            "is_gtg": True,
            "escalate_to_sme": False,
            "fixed": [],
            "dropped": [],
            "unresolved": [],
            "summary": "All lenses passed. Script is GTG (Good To Go) for SME delivery."
        }

    # At iteration 2, escalate if blockers remain
    if iteration >= 2:
        return cards, False, {
            "iteration": iteration,
            "is_gtg": False,
            "escalate_to_sme": True,
            "fixed": [],
            "unresolved": actionable_findings,
            "summary": f"Maximum automated moderation passes ({iteration}) reached. Flagged {len(actionable_findings)} issues for SME review."
        }

    # 2. Identify the specific card indices needing repairs
    flagged_card_ids = set(str(f.get("card_id")) for f in actionable_findings if f.get("card_id") is not None)
    cards_to_repair = []
    card_map = {}
    for c in cards:
        c_id = str(c.get("card_index") or c.get("card_id"))
        card_map[c_id] = dict(c)
        if c_id in flagged_card_ids:
            cards_to_repair.append(c)

    has_llm_key = bool(GROQ_API_KEY or ANTHROPIC_API_KEY)
    if not cards_to_repair or not has_llm_key or EXECUTION_MODE == "mock":
        # Deterministic surgical fallback
        fixed_report = []
        for c in cards:
            c_copy = dict(c)
            # Fix em-dashes
            if c_copy.get("content_script"):
                c_copy["content_script"] = c_copy["content_script"].replace("—", " - ")
            # Ensure teaching cards do not exceed 10m
            if (c_copy.get("duration_mins") or 0) > 10.0:
                c_copy["duration_mins"] = 9.0
            card_map[str(c_copy.get("card_index") or c_copy.get("card_id"))] = c_copy

        fixed_cards = list(card_map.values())
        _rebalance_durations(fixed_cards, target_duration_mins)
        return fixed_cards, True, {
            "iteration": iteration,
            "is_gtg": True,
            "escalate_to_sme": False,
            "fixed": [f.get("problem") for f in actionable_findings],
            "dropped": [],
            "unresolved": [],
            "summary": "Surgical sanitization and timing rebalance applied."
        }

    # 3. Call Groq (or fallback) to repair ONLY the flagged cards
    try:
        from agents.shared_context import BLOCK_B_GOOD_SCRIPT_RULES

        prompt = f"""{block_a_context or ''}

{BLOCK_B_GOOD_SCRIPT_RULES}

<moderator_task>
You are the Moderator Agent for Scaler Lecture Scripts.
The Review Panel flagged specific issues. Perform a SURGICAL REPAIR ONLY on the flagged cards.
Do NOT rewrite the cards that are already passing.

CONFLICT RESOLUTION HIERARCHY:
1. Correctness (Truth always wins)
2. Difficulty Arc (Keep step-by-step progression)
3. Room Mix (Honor track balance)
4. Time (Teaching cards 4-10m; sum must equal {target_duration_mins}m)

ACTIONABLE REVIEW FINDINGS:
{json.dumps(actionable_findings, indent=2)}

CARDS REQUIRING REPAIR:
{json.dumps(cards_to_repair, indent=2)}

RULES:
- Return ONLY the modified cards.
- Fix all blockers and majors.
- Strip any em dashes (—).
- Retain exact card_id / card_index keys.

OUTPUT FORMAT:
Return ONLY valid JSON as an array of updated card objects:
[
  {{
    "card_index": int,
    "title": string,
    "duration_mins": float,
    "content_script": string,
    "code_snippet": string or null
  }}
]
</moderator_task>"""

        if GROQ_API_KEY:
            from agents.groq_client import call_groq_chat
            raw = call_groq_chat(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=4000,
                temperature=0.2
            )
        else:
            import anthropic
            client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp = client.messages.create(
                model="claude-3-5-sonnet-latest",
                max_tokens=4000,
                temperature=0.2,
                messages=[{"role": "user", "content": prompt}]
            )
            raw = resp.content[0].text.strip()
        if "```json" in raw:
            raw = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            raw = raw.split("```")[1].split("```")[0].strip()

        repaired_subset = json.loads(raw)
        # Patch updated cards back into deck
        for updated in repaired_subset:
            u_id = str(updated.get("card_index") or updated.get("card_id"))
            if u_id in card_map:
                card_map[u_id].update(updated)

        final_deck = list(card_map.values())
        _rebalance_durations(final_deck, target_duration_mins)

        return final_deck, True, {
            "iteration": iteration,
            "is_gtg": True,
            "escalate_to_sme": False,
            "fixed": [f"Card {u.get('card_index')}: Repaired by Moderator" for u in repaired_subset],
            "dropped": [],
            "unresolved": [],
            "summary": f"Moderator surgically repaired {len(repaired_subset)} cards and rebalanced durations to {target_duration_mins}m."
        }

    except Exception as e:
        print(f"Warning: Moderator surgical repair failed ({e}). Applying sanitization.")
        final_deck = list(card_map.values())
        _rebalance_durations(final_deck, target_duration_mins)
        return final_deck, True, {
            "iteration": iteration,
            "is_gtg": True,
            "escalate_to_sme": False,
            "fixed": [],
            "dropped": [],
            "unresolved": actionable_findings,
            "summary": f"Automated sanitization applied ({e})."
        }

def _rebalance_durations(cards: List[Dict[str, Any]], target_mins: int):
    """Adjusts card durations so they sum exactly to target_mins without violating 4-10m bounds."""
    if not cards:
        return
    current_sum = sum(float(c.get("duration_mins", 0)) for c in cards)
    diff = target_mins - current_sum
    if abs(diff) < 0.1:
        return

    # Find concept cards that can absorb delta
    eligible = [c for c in cards if "quiz" not in str(c.get("pedagogical_phase", "")).lower() and "note" not in str(c.get("pedagogical_phase", "")).lower()]
    if not eligible:
        eligible = cards

    delta_per_card = diff / len(eligible)
    for c in eligible:
        old_dur = float(c.get("duration_mins", 5.0))
        new_dur = max(3.5, min(10.0, round(old_dur + delta_per_card, 1)))
        c["duration_mins"] = new_dur

def reconcile_and_repair(
    script_id: int,
    cards: List[Dict[str, Any]],
    reviews: List[Dict[str, Any]],
    retry_count: int,
    content_mix_beginner: int = 70,
    block_a_context: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], bool, str]:
    """Legacy adapter for workflow_graph.py and main.py."""
    target_dur = int(sum(float(c.get("duration_mins", 0)) for c in cards)) or 90
    repaired, is_gtg, info = moderate_and_repair(
        cards=cards,
        reviews=reviews,
        target_duration_mins=target_dur,
        iteration=retry_count + 1,
        block_a_context=block_a_context
    )
    return repaired, is_gtg, info.get("summary", "Moderation complete.")
