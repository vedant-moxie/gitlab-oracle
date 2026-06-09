"""GitLab Oracle — ADK agent definition.

Exposes `root_agent` (the name `adk run` / Agent Engine expect). Combines the
four institutional-memory tools with the live GitLab MCP toolset.
"""
from __future__ import annotations

from google.adk.agents import Agent
from google.genai.types import GenerateContentConfig

import config
from agent.gitlab_mcp import get_gitlab_mcp_toolset
from agent.prompts import SYSTEM_INSTRUCTION
from agent.tools import MEMORY_TOOLS


def build_agent() -> Agent:
    tools = list(MEMORY_TOOLS)
    mcp = get_gitlab_mcp_toolset()
    if mcp is not None:
        tools.append(mcp)
    return Agent(
        name="gitlab_oracle",
        model=config.AGENT_MODEL,
        description="Institutional-memory agent over a repository's full GitLab history.",
        instruction=SYSTEM_INSTRUCTION,
        tools=tools,
        generate_content_config=GenerateContentConfig(temperature=0.0),
    )


root_agent = build_agent()
