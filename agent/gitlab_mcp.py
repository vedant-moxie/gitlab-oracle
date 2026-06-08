"""GitLab official MCP server as an ADK toolset.

This is the Partner-MCP integration required by the hackathon rules. The agent
uses it for LIVE GitLab operations the historical index can't provide:
reading the current merge request and posting comments back.

Two transports (env-selectable):
  * Native GitLab MCP over Streamable HTTP (GitLab 18+): GITLAB_MCP_URL
  * Local stdio MCP server via npx:                     GITLAB_MCP_STDIO=1
"""
from __future__ import annotations

import os

from google.adk.tools.mcp_tool.mcp_toolset import (
    McpToolset,
    StdioConnectionParams,
    StdioServerParameters,
    StreamableHTTPConnectionParams,
)

import config


def get_gitlab_mcp_toolset() -> McpToolset | None:
    """Build the GitLab MCP toolset, or None if disabled (memory-only mode)."""
    if os.environ.get("DISABLE_GITLAB_MCP") == "1":
        return None
    try:
        pat = config.get_secret("gitlab-pat")
    except Exception:
        return None

    if config.GITLAB_MCP_STDIO:
        return McpToolset(
            connection_params=StdioConnectionParams(
                server_params=StdioServerParameters(
                    command="npx",
                    args=["-y", "@zereight/mcp-gitlab"],
                    env={
                        "GITLAB_PERSONAL_ACCESS_TOKEN": pat,
                        "GITLAB_API_URL": f"{config.GITLAB_URL}/api/v4",
                    },
                )
            ),
        )

    return McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=config.GITLAB_MCP_URL,
            headers={"Authorization": f"Bearer {pat}"},
        ),
    )
