import os
import json
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
FALLBACK_GROQ_MODEL = "qwen/qwen3.8-27b"

def get_groq_api_key() -> Optional[str]:
    return os.getenv("GROQ_API_KEY")

def is_groq_available() -> bool:
    key = get_groq_api_key()
    return bool(key and key.strip())

def call_groq_chat(
    messages: List[Dict[str, str]],
    system: Optional[str] = None,
    max_tokens: int = 4000,
    temperature: float = 0.2,
    json_mode: bool = False
) -> str:
    """
    Executes a chat completion call using Groq API as primary LLM.
    Uses OpenAI-compatible client endpoint: https://api.groq.com/openai/v1.
    Includes fallback between Groq models if needed.
    """
    api_key = get_groq_api_key()
    if not api_key:
        raise ValueError("GROQ_API_KEY is not configured in environment.")

    from openai import OpenAI

    client = OpenAI(
        base_url="https://api.groq.com/openai/v1",
        api_key=api_key
    )

    formatted_messages = []
    if system:
        formatted_messages.append({"role": "system", "content": system})
    formatted_messages.extend(messages)

    # Ensure max_tokens accommodates reasoning if model uses thinking tokens
    eff_tokens = max(max_tokens, 2048)

    # Attempt primary model (gpt-oss-120b)
    try:
        kwargs = {
            "model": DEFAULT_GROQ_MODEL,
            "messages": formatted_messages,
            "max_tokens": eff_tokens,
            "temperature": temperature
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = client.chat.completions.create(**kwargs)
        content = resp.choices[0].message.content or ""
        if content.strip():
            return content.strip()
    except Exception as e_primary:
        print(f"Groq primary model ({DEFAULT_GROQ_MODEL}) error: {e_primary}. Trying fallback ({FALLBACK_GROQ_MODEL})...")

    # Fallback model (qwen3.8-27b)
    try:
        kwargs = {
            "model": FALLBACK_GROQ_MODEL,
            "messages": formatted_messages,
            "max_tokens": max_tokens,
            "temperature": temperature
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = client.chat.completions.create(**kwargs)
        content = resp.choices[0].message.content or ""
        return content.strip()
    except Exception as e_fallback:
        print(f"Groq fallback model ({FALLBACK_GROQ_MODEL}) error: {e_fallback}.")
        raise e_fallback
