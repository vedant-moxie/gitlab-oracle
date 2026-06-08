"""Optional Arize Phoenix / OpenTelemetry tracing for the Oracle.

ADK emits OpenTelemetry spans for every agent turn and tool call. If a Phoenix
collector endpoint is configured, we register a tracer provider so those spans
stream to Phoenix — giving judges a live view of the agent's reasoning and tool
use. No-ops cleanly when PHOENIX_COLLECTOR_ENDPOINT is unset.
"""
from __future__ import annotations

import os

_initialized = False


def init_tracing() -> None:
    global _initialized
    if _initialized or not os.environ.get("PHOENIX_COLLECTOR_ENDPOINT"):
        return
    try:
        from phoenix.otel import register

        register(
            project_name=os.environ.get("PHOENIX_PROJECT_NAME", "gitlab-oracle"),
            auto_instrument=True,
        )
        _initialized = True
        print("📡 Phoenix tracing enabled")
    except Exception as e:  # never let tracing break the agent
        print(f"(phoenix tracing disabled: {e})")
