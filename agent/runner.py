from __future__ import annotations

"""Reusable ADK runner: run the Oracle on a single prompt, return final text.

Shared by the webhook service and the chat UI.
"""

import uuid

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from agent.agent import root_agent
from agent.observability import init_tracing
from agent import context

init_tracing()

_APP = "gitlab_oracle"
_session_service = InMemorySessionService()
_runner = Runner(agent=root_agent, app_name=_APP, session_service=_session_service)

async def ask(prompt: str, project_id: str, user_id: str = "anon", session_id: str | None = None) -> str:
    """Run one turn through the agent and return its final text response."""
    context.current_project_id.set(project_id)
    
    session_id = session_id or f"s-{uuid.uuid4().hex[:12]}"
    # Reuse the session across turns (preserves conversation memory); only create
    # it the first time we see this id.
    existing = await _session_service.get_session(
        app_name=_APP, user_id=user_id, session_id=session_id
    )
    if existing is None:
        await _session_service.create_session(
            app_name=_APP, user_id=user_id, session_id=session_id
        )
    content = types.Content(role="user", parts=[types.Part(text=prompt)])
    final = ""
    async for event in _runner.run_async(
        user_id=user_id, session_id=session_id, new_message=content
    ):
        if event.is_final_response() and event.content and event.content.parts:
            final = "".join(p.text or "" for p in event.content.parts)
    return final.strip()
