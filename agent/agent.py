from __future__ import annotations

"""GitLab Oracle — ADK agent definition.

Exposes `root_agent` (the name `adk run` / Agent Engine expect). Combines the
four institutional-memory tools with the live GitLab MCP toolset.
"""

import os

from google.adk.agents import Agent
from google.genai.types import GenerateContentConfig

import config
from agent.gitlab_mcp import get_gitlab_mcp_toolset
from agent.prompts import SYSTEM_INSTRUCTION
from agent.tools import MEMORY_TOOLS


def _resolve_model():
    """Gemini models pass straight through to ADK; anything else (Claude, Llama,
    Mistral... from Vertex Model Garden) is routed via LiteLLM.

    Examples:
        AGENT_MODEL=gemini-3-flash-preview              -> native
        AGENT_MODEL=claude-sonnet-4-5@20250929          -> vertex_ai/claude-...
        AGENT_MODEL=vertex_ai/claude-sonnet-4-5@2025... -> as-is via LiteLLM

    Partner models need (a) enablement in Model Garden and (b) non-zero quota
    for 'online_prediction_requests_per_base_model' in PARTNER_MODEL_LOCATION.
    """
    m = config.AGENT_MODEL
    if m.startswith("gemini"):
        return m
    from google.adk.models.lite_llm import LiteLlm

    return LiteLlm(
        model=m if "/" in m else f"vertex_ai/{m}",
        vertex_project=config.PROJECT_ID,
        vertex_location=os.environ.get("PARTNER_MODEL_LOCATION", "global"),
    )


def build_agent() -> Agent:
    tools = list(MEMORY_TOOLS)
    mcp = get_gitlab_mcp_toolset()
    if mcp is not None:
        tools.append(mcp)
    return Agent(
        name="gitlab_oracle",
        model=_resolve_model(),
        description="Institutional-memory agent over a repository's full GitLab history.",
        instruction=SYSTEM_INSTRUCTION,
        tools=tools,
        generate_content_config=GenerateContentConfig(temperature=0.0),
    )

root_agent = build_agent()
