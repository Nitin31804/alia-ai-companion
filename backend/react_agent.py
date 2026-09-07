"""
react_agent.py – Lightweight ReAct (Reasoning + Acting) orchestration layer.
Uses gemini-2.0-flash (new google-genai SDK) to decide which tools to invoke.
"""

import json
import logging
import httpx

REACT_SYSTEM_PROMPT = """
You are a decision engine for a multimodal AI assistant.
Given a user message, decide which ACTIONS the assistant should take BEFORE generating its final answer.

Available actions (return a JSON list of strings):
  "recall_memory"  – search long-term memory for relevant past conversations
  "look_webcam"    – capture a live webcam frame from the user's camera
  "look_screen"    – use a screen-capture frame the user has shared
  "respond"        – generate a text (and voice) response (always include this)

Rules:
- If the user asks about something visual (describes an object, asks "what is this?", "what do you see?") → include "look_webcam"
- If the user says "on my screen", "in this window", "look at my code/browser" → include "look_screen"
- If the user references past topics, uses "remember", "earlier", "last time" → include "recall_memory"
- If unsure, only return ["respond"]
- ALWAYS include "respond" in the list.

Respond with ONLY a JSON array, no explanation. Example: ["recall_memory", "respond"]
"""

async def react_decide(user_text: str, screen_frame_available: bool = False) -> list[str]:
    """Instantly decide which actions to take using fast keyword heuristics to eliminate 3-5 seconds of LLM latency."""
    actions = ["respond"]
    
    text_lower = user_text.lower()
    
    # Fast memory recall heuristic
    memory_keywords = ["remember", "earlier", "last time", "past", "yesterday", "told you", "before", "did i say", "my name", "what is my"]
    if any(kw in text_lower for kw in memory_keywords):
        actions.append("recall_memory")
        
    return actions
