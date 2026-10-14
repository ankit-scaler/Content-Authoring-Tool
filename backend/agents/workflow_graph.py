"""
LangGraph Multi-Agent Orchestrator for Scaler AI Script Studio.
Implements StateGraph with:
1. Context/Memory Retriever Node
2. Dynamic Outline Architect Node (duration-budgeted)
3. Spoken Script Drafter Node (cards, diagrams, code traces)
4. Multi-Lens Parallel Reviewer Node (Gemini 1.5 Flash)
5. Moderator & Conditional Auto-Repair Loop (up to 2 iterations)
"""

import os
from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, END

# Import existing core agent logic
from agents.memory_engine import retrieve_context_memory
from agents.writer import generate_outline, draft_card_batch
from agents.reviewer import run_multi_lens_reviews
from agents.moderator import reconcile_and_repair
from database import SyncSessionLocal


class ScriptWorkflowState(TypedDict):
    script_id: int
    class_id: int
    class_title: str
    agendas: List[str]
    duration_minutes: int
    content_mix_beginner: int
    code_ratio: int
    additional_resources: Optional[str]
    api_docs: Optional[str]
    reference_urls: Optional[str]
    
    # State accumulated across nodes
    memory_context: Dict[str, Any]
    outline_cards: List[Dict[str, Any]]
    drafted_cards: List[Dict[str, Any]]
    reviews: List[Dict[str, Any]]
    repair_count: int
    is_gtg: bool
    moderator_summary: str
    status: str
    error: Optional[str]


def node_retrieve_memory(state: ScriptWorkflowState) -> Dict[str, Any]:
    """
    Node 1: Pulls cross-class continuity from previous lectures in the module
    (what was taught before, terms mastered, and sets the cliffhanger for what comes next).
    Also locks current official documentation directives to prevent hallucinations.
    """
    db = SyncSessionLocal()
    try:
        combined_resources = state.get("additional_resources") or ""
        if state.get("api_docs"):
            combined_resources += f"\n[CURRENT OFFICIAL API DOCS]:\n{state.get('api_docs')}"
        if state.get("reference_urls"):
            combined_resources += f"\n[OFFICIAL REFERENCE URLS]:\n{state.get('reference_urls')}"

        # FR-12: If no explicit reference URLs provided, pull module pre-approved sources from database
        from models import Class
        cls_entity = db.query(Class).filter(Class.id == state["class_id"]).first()
        if cls_entity and cls_entity.module and cls_entity.module.approved_sources:
            combined_resources += f"\n[MODULE PRE-APPROVED OFFICIAL SOURCES (FR-12)]:\n{cls_entity.module.approved_sources}"
        elif not state.get("reference_urls") and not state.get("api_docs"):
            # Provide high-authority default official docs based on class title
            combined_resources += f"\n[RECOMMENDED OFFICIAL REFERENCE DOCS]:\nOfficial documentation for {state['class_title']}"

        from agents.shared_context import build_block_a_context
        block_a = build_block_a_context(
            db=db,
            class_id=state["class_id"],
            duration_minutes=state["duration_minutes"],
            content_mix_beginner=state["content_mix_beginner"],
            code_ratio=state["code_ratio"],
            custom_title=state["class_title"],
            custom_agendas=state["agendas"],
            learning_outcomes=state.get("learning_outcomes"),
            api_docs=state.get("api_docs"),
            reference_urls=state.get("reference_urls"),
            additional_resources=state.get("additional_resources")
        )

        memory = retrieve_context_memory(
            db, 
            state["class_id"], 
            combined_resources.strip() or None
        )
        return {
            "memory_context": memory,
            "block_a_context": block_a,
            "status": "MEMORY_RETRIEVED"
        }
    finally:
        db.close()


def node_outline_architect(state: ScriptWorkflowState) -> Dict[str, Any]:
    """Node 2: Generates duration-budgeted card outline strictly matching duration_minutes."""
    outline = generate_outline(
        class_title=state["class_title"],
        agendas=state["agendas"],
        duration_minutes=state["duration_minutes"],
        content_mix_beginner=state["content_mix_beginner"],
        code_ratio=state["code_ratio"],
        memory_context=state["memory_context"],
        additional_resources=state.get("additional_resources"),
        learning_outcomes=state.get("learning_outcomes"),
        api_docs=state.get("api_docs"),
        reference_urls=state.get("reference_urls"),
        block_a_context=state.get("block_a_context")
    )
    return {
        "outline_cards": outline,
        "status": "OUTLINE_GENERATED"
    }


def node_script_drafter(state: ScriptWorkflowState) -> Dict[str, Any]:
    """Node 3: Generates detailed verbatim scripts, Mermaid visuals, and code traces."""
    cards_to_draft = state.get("drafted_cards") or state["outline_cards"]
    total_cards = len(cards_to_draft)
    
    # Batch draft cards to prevent context saturation
    batch_size = 5
    drafted = []
    for i in range(0, total_cards, batch_size):
        start_idx = i + 1
        end_idx = min(i + batch_size, total_cards)
        drafted_chunk = draft_card_batch(
            class_title=state["class_title"],
            outline_cards=cards_to_draft,
            batch_start_idx=start_idx,
            batch_end_idx=end_idx,
            memory_context=state.get("memory_context") or {},
            code_ratio=state.get("code_ratio", 50),
            content_mix_beginner=state.get("content_mix_beginner", 65),
            block_a_context=state.get("block_a_context")
        )
        drafted.extend(drafted_chunk)
        
    return {
        "drafted_cards": drafted,
        "status": "SCRIPT_DRAFTED"
    }


def node_multi_lens_reviewer(state: ScriptWorkflowState) -> Dict[str, Any]:
    """Node 4: Evaluates script across Technical, Clarity, and Coverage lenses using Gemini."""
    reviews = run_multi_lens_reviews(
        class_title=state["class_title"],
        cards=state["drafted_cards"],
        target_duration_mins=state["duration_minutes"],
        content_mix_beginner=state["content_mix_beginner"],
        block_a_context=state.get("block_a_context")
    )
    return {
        "reviews": reviews,
        "status": "REVIEWS_COMPLETED"
    }


def node_moderator_repair(state: ScriptWorkflowState) -> Dict[str, Any]:
    """Node 5: Reconciles conflicts and performs targeted repairs if issues exist."""
    current_repairs = state.get("repair_count", 0)
    repaired_cards, is_gtg, summary = reconcile_and_repair(
        script_id=state["script_id"],
        cards=state["drafted_cards"],
        reviews=state["reviews"],
        retry_count=current_repairs,
        content_mix_beginner=state["content_mix_beginner"],
        block_a_context=state.get("block_a_context")
    )
    return {
        "drafted_cards": repaired_cards,
        "is_gtg": is_gtg,
        "moderator_summary": summary,
        "repair_count": current_repairs + 1,
        "status": "MODERATED"
    }


def router_should_repair(state: ScriptWorkflowState) -> str:
    """Conditional Edge: Determines if script passes or routes to auto-repair."""
    # If all reviews passed or max repair cycles reached, finish
    if state.get("is_gtg", False) or state.get("repair_count", 0) >= 2:
        return "end"
    
    # Check if any review failed
    has_failures = any(not r.get("passed", False) for r in state.get("reviews", []))
    if has_failures and state.get("repair_count", 0) < 2:
        return "repair"
    return "end"


def build_script_workflow_graph():
    """Compiles the LangGraph StateGraph for production script generation."""
    workflow = StateGraph(ScriptWorkflowState)

    # 1. Add Nodes
    workflow.add_node("memory_node", node_retrieve_memory)
    workflow.add_node("outline_architect", node_outline_architect)
    workflow.add_node("script_drafter", node_script_drafter)
    workflow.add_node("reviewer_panel", node_multi_lens_reviewer)
    workflow.add_node("moderator_repair", node_moderator_repair)

    # 2. Define Execution Edges
    workflow.set_entry_point("memory_node")
    workflow.add_edge("memory_node", "outline_architect")
    workflow.add_edge("outline_architect", "script_drafter")
    workflow.add_edge("script_drafter", "reviewer_panel")
    workflow.add_edge("reviewer_panel", "moderator_repair")

    # 3. Add Conditional Cycling Edge (Self-Correction Loop)
    workflow.add_conditional_edges(
        "moderator_repair",
        router_should_repair,
        {
            "repair": "script_drafter",  # Re-draft / refine violating sections
            "end": END                   # Terminate workflow and deliver to SME
        }
    )

    return workflow.compile()


# Singleton compiled graph instance ready for use across endpoints
script_graph = build_script_workflow_graph()
