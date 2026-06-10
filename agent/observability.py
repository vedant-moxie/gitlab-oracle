from __future__ import annotations

"""Optional Arize Phoenix / OpenTelemetry tracing for the Oracle.

ADK emits OpenTelemetry spans for every agent turn and tool call. If a Phoenix
collector endpoint is configured, we register a tracer provider so those spans
stream to Phoenix — giving judges a live view of the agent's reasoning and tool
use. No-ops cleanly when PHOENIX_COLLECTOR_ENDPOINT is unset.

On Cloud Run we additionally fan spans out to Google Cloud Trace (gated on
ENABLE_CLOUD_TRACE=1) so judges can see real reasoning traces in the same GCP
console they're already exploring.
"""

import os

_initialized = False

# Cloud Trace enabled in prod via ENABLE_CLOUD_TRACE=1. Local dev keeps Phoenix only.
def _init_cloud_trace() -> None:
    """Attach a Cloud Trace BatchSpanProcessor to the active tracer provider.

    Any failure here is swallowed — the agent must never crash on boot
    because of tracing.
    """
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter

        provider = trace.get_tracer_provider()
        # If Phoenix didn't register a real SDK TracerProvider, install one so
        # the Cloud Trace exporter has somewhere to attach.
        if not isinstance(provider, TracerProvider):
            provider = TracerProvider()
            trace.set_tracer_provider(provider)

        exporter = CloudTraceSpanExporter()
        provider.add_span_processor(BatchSpanProcessor(exporter))
        print("📡 Cloud Trace export enabled")
    except Exception as e:  # never let tracing break the agent
        print(f"⚠️  Cloud Trace export disabled: {e}")


def init_tracing() -> None:
    global _initialized
    if _initialized:
        return
    if not os.environ.get("PHOENIX_COLLECTOR_ENDPOINT"):
        # Phoenix path: no-op (preserves original behavior). Cloud Trace can
        # still attach below if explicitly enabled.
        if os.environ.get("ENABLE_CLOUD_TRACE") == "1":
            _init_cloud_trace()
            _initialized = True
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

    if os.environ.get("ENABLE_CLOUD_TRACE") == "1":
        _init_cloud_trace()
        _initialized = True
