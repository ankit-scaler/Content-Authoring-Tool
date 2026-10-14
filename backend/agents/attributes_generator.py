"""
Agent 3: Attributes Generator Agent
Generates visual assets (Mermaid diagrams, HTML animations, image specs)
from [[VISUAL]] placeholder requests emitted by the Writer agent.
Uses Gemini for Mermaid and Claude for animations.
"""

import os
import json
from typing import Dict, Any, Optional, List
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
EXECUTION_MODE = os.getenv("EXECUTION_MODE", "hybrid")


# ── Attributes Generator System Prompt ───────────────────────────────────────

ATTR_GEN_SYSTEM = """\
You are the Attributes Generator for Scaler's script authoring tool.
{block_a}

RULES
- 7 nodes or fewer. Before/after is two separate visuals. Flows show one step per stage.
- Use only terms already defined in the card or earlier.
- Use names from the running example exactly.
- No paid assets or copyrighted material. Free resources only.
"""


def generate_visual(
    visual_request: Dict[str, Any],
    card_text: str,
    running_example: str,
    block_a_context: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generates a visual asset based on the visual_request from the Writer agent.

    visual_request keys: id, type, intent, nodes, step, card_id
    Returns: {"id": str, "type": str, "content": str, "alt_text": str,
              "caption": str, "licence": str|null}
    """
    vis_type = visual_request.get("type", "mermaid")

    if vis_type == "mermaid":
        return _generate_mermaid(visual_request, card_text, running_example, block_a_context)
    elif vis_type == "animation":
        return _generate_animation(visual_request, card_text, running_example, block_a_context)
    elif vis_type == "image":
        return _generate_image_spec(visual_request, card_text, running_example)
    else:
        return {
            "id": visual_request.get("id", "vis_unknown"),
            "type": vis_type,
            "content": f"[[VISUAL: {visual_request.get('intent', 'unknown')}]]",
            "alt_text": visual_request.get("intent", "Visual placeholder"),
            "caption": f"Visual: {visual_request.get('intent', '')}",
            "licence": None
        }


def generate_visuals_batch(
    visual_requests: List[Dict[str, Any]],
    cards: List[Dict[str, Any]],
    running_example: str,
    block_a_context: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generates all visual assets for a section's visual_requests.
    Returns a list of generated assets.
    """
    results = []
    card_text_map = {c.get("card_id", ""): c.get("body_markdown", "") for c in cards}

    for req in visual_requests:
        card_id = req.get("card_id", "")
        card_text = card_text_map.get(card_id, "")
        asset = generate_visual(req, card_text, running_example, block_a_context)
        results.append(asset)

    return results


# ── Mermaid Generation ───────────────────────────────────────────────────────

def _generate_mermaid(
    visual_request: Dict[str, Any],
    card_text: str,
    running_example: str,
    block_a_context: Optional[str] = None
) -> Dict[str, Any]:
    """Generates a valid Mermaid diagram with max 7 nodes."""
    vis_id = visual_request.get("id", "mermaid_01")
    intent = visual_request.get("intent", "system flow")
    nodes = visual_request.get("nodes", [])

    has_llm = bool(GROQ_API_KEY or ANTHROPIC_API_KEY)
    if has_llm and EXECUTION_MODE in ("live", "hybrid"):
        try:
            prompt = (
                f"Generate a clean, valid Mermaid.js diagram.\n"
                f"INTENT: {intent}\n"
                f"NODES (max 7): {json.dumps(nodes[:7])}\n"
                f"RUNNING EXAMPLE: {running_example}\n"
                f"Prefer flowchart TD, flowchart LR, sequenceDiagram, or stateDiagram.\n"
                f"Return ONLY the raw Mermaid code, no markdown fences.\n"
                f"Max 7 nodes. Flat, clear alphanumeric labels. No HTML in labels."
            )

            if GROQ_API_KEY:
                from agents.groq_client import call_groq_chat
                raw = call_groq_chat(
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=2000,
                    temperature=0.2
                )
            else:
                import anthropic
                client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                resp = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=2000,
                    temperature=0.2,
                    messages=[{"role": "user", "content": prompt}]
                )
                raw = resp.content[0].text.strip()

            # Strip markdown fences if present
            if "```mermaid" in raw:
                raw = raw.split("```mermaid")[1].split("```")[0].strip()
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0].strip()

            return {
                "id": vis_id,
                "type": "mermaid",
                "content": raw,
                "alt_text": intent,
                "caption": f"Figure: {intent}",
                "licence": None
            }

        except Exception as e:
            print(f"Mermaid generation warning: {e}")

    # Fallback static diagram
    node_labels = nodes[:7] if nodes else ["Start", "Process", "End"]
    lines = ["graph LR"]
    for i in range(len(node_labels) - 1):
        safe_a = node_labels[i].replace(" ", "_")
        safe_b = node_labels[i + 1].replace(" ", "_")
        lines.append(f"  {safe_a}[{node_labels[i]}] --> {safe_b}[{node_labels[i+1]}]")

    return {
        "id": vis_id,
        "type": "mermaid",
        "content": "\n".join(lines),
        "alt_text": intent,
        "caption": f"Figure: {intent}",
        "licence": None
    }


# ── Animation Generation ────────────────────────────────────────────────────

def _generate_animation(
    visual_request: Dict[str, Any],
    card_text: str,
    running_example: str,
    block_a_context: Optional[str] = None
) -> Dict[str, Any]:
    """Generates a self-contained HTML animation with Play/Replay, light/dark mode."""
    vis_id = visual_request.get("id", "anim_01")
    intent = visual_request.get("intent", "step-by-step animation")
    nodes = visual_request.get("nodes", [])

    has_llm_key = bool(GROQ_API_KEY or ANTHROPIC_API_KEY)
    if has_llm_key and EXECUTION_MODE in ("live", "hybrid"):
        try:
            prompt = (
                f"Generate a self-contained HTML file with inline CSS and JS.\n"
                f"INTENT: {intent}\n"
                f"STEPS/NODES: {json.dumps(nodes[:7])}\n"
                f"RUNNING EXAMPLE: {running_example}\n\n"
                "REQUIREMENTS:\n"
                "- No external assets or CDN links.\n"
                "- Play and Replay buttons.\n"
                "- Light and dark mode support (use prefers-color-scheme).\n"
                "- Captions for each stage.\n"
                "- Clean, modern design.\n\n"
                "Return ONLY the HTML code, no markdown fences."
            )

            if GROQ_API_KEY:
                from agents.groq_client import call_groq_chat
                html_content = call_groq_chat(
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=4000,
                    temperature=0.2
                )
            else:
                import anthropic
                client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                resp = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=4000,
                    temperature=0.2,
                    messages=[{"role": "user", "content": prompt}]
                )
                html_content = resp.content[0].text.strip()
            if "```html" in html_content:
                html_content = html_content.split("```html")[1].split("```")[0].strip()
            elif "```" in html_content:
                html_content = html_content.split("```")[1].split("```")[0].strip()

            return {
                "id": vis_id,
                "type": "animation",
                "content": html_content,
                "alt_text": intent,
                "caption": f"Interactive: {intent}",
                "licence": None
            }

        except Exception as e:
            print(f"Animation generation warning: {e}")

    # Fallback static animation
    fallback_html = (
        '<div style="background:#0f172a; padding:20px; border-radius:12px; '
        'font-family:sans-serif; color:#f8fafc; text-align:center;">'
        f'<h4 style="color:#38bdf8;">{intent}</h4>'
        '<div style="display:flex; justify-content:space-around; align-items:center; margin-top:20px;">'
    )
    for node in (nodes[:5] or ["Step 1", "Step 2", "Step 3"]):
        fallback_html += (
            f'<div style="padding:12px; background:#1e293b; border:1px solid #3b82f6; '
            f'border-radius:8px; margin:4px;">{node}</div>'
        )
    fallback_html += '</div></div>'

    return {
        "id": vis_id,
        "type": "animation",
        "content": fallback_html,
        "alt_text": intent,
        "caption": f"Interactive: {intent}",
        "licence": None
    }


# ── Image Spec Generation ───────────────────────────────────────────────────

def _generate_image_spec(
    visual_request: Dict[str, Any],
    card_text: str,
    running_example: str
) -> Dict[str, Any]:
    """Returns image spec (subject, labels, layout, style) and optional free source URL."""
    vis_id = visual_request.get("id", "img_01")
    intent = visual_request.get("intent", "diagram")
    nodes = visual_request.get("nodes", [])

    spec = {
        "subject": intent,
        "labels": nodes[:7],
        "layout": "horizontal flow" if len(nodes) <= 4 else "grid",
        "style": "2D Excalidraw-style blueprint, dark background, hand-drawn wireframe"
    }

    # Render clean, attractive SVG infographic for immediate browser presentation
    box_elements = []
    labels = nodes[:6] if nodes else ["Input", "Processing", "Validation", "Output"]
    total_w = 720
    box_w = min(140, int((total_w - 40) / max(1, len(labels))))
    gap = int((total_w - (box_w * len(labels))) / max(1, len(labels) + 1))
    
    for i, lbl in enumerate(labels):
        x = gap + i * (box_w + gap)
        box_elements.append(f'''
            <g transform="translate({x}, 70)">
                <rect width="{box_w}" height="65" rx="8" fill="#1e293b" stroke="#38bdf8" stroke-width="2"/>
                <text x="{box_w // 2}" y="38" fill="#f8fafc" font-size="13" font-weight="600" text-anchor="middle" font-family="system-ui, sans-serif">{lbl[:18]}</text>
            </g>
        ''')
        if i < len(labels) - 1:
            arrow_x = x + box_w
            box_elements.append(f'''
                <path d="M {arrow_x + 4} 102 L {arrow_x + gap - 4} 102" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrow)"/>
            ''')

    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 740 180" style="width:100%; max-width:740px; background:#0f172a; border-radius:10px; border:1px solid #334155;">
        <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
            </marker>
        </defs>
        <text x="24" y="34" fill="#38bdf8" font-size="15" font-weight="700" font-family="system-ui, sans-serif">{intent}</text>
        {''.join(box_elements)}
    </svg>'''

    return {
        "id": vis_id,
        "type": "image",
        "content": svg_content,
        "alt_text": intent,
        "caption": f"Visual Architecture: {intent}",
        "licence": "Generated / Free"
    }


# ── Legacy API compatibility ─────────────────────────────────────────────────

def generate_mermaid_diagram(concept_title: str, domain_analogy: str, is_recap: bool = False) -> Dict[str, Any]:
    """Legacy wrapper for backward compatibility."""
    req = {
        "id": f"mermaid_{concept_title[:10].lower().replace(' ', '_')}",
        "type": "mermaid",
        "intent": concept_title,
        "nodes": ["Client", "Gateway", "Stream", "Worker", "Store"] if is_recap else [],
        "card_id": "legacy"
    }
    result = generate_visual(req, "", domain_analogy)
    return {
        "type": result["type"],
        "content": result["content"],
        "caption": result["caption"]
    }


def generate_html_animation(concept_title: str) -> Dict[str, Any]:
    """Legacy wrapper for backward compatibility."""
    req = {
        "id": f"anim_{concept_title[:10].lower().replace(' ', '_')}",
        "type": "animation",
        "intent": concept_title,
        "nodes": [],
        "card_id": "legacy"
    }
    result = generate_visual(req, "", "")
    return {
        "type": result["type"],
        "content": result["content"],
        "caption": result["caption"]
    }


def generate_image_asset(concept_title: str, prompt_description: str) -> Dict[str, Any]:
    """Legacy wrapper for backward compatibility."""
    req = {
        "id": f"img_{concept_title[:10].lower().replace(' ', '_')}",
        "type": "image",
        "intent": concept_title,
        "nodes": [],
        "card_id": "legacy"
    }
    result = generate_visual(req, "", prompt_description)
    return {
        "type": result["type"],
        "content": result["content"],
        "caption": result["caption"]
    }
