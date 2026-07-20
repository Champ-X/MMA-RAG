from __future__ import annotations

from fastapi import FastAPI

from nexus.config import NexusSettings


def configure_telemetry(app: FastAPI, settings: NexusSettings) -> bool:
    """Configure vendor-neutral local tracing without making telemetry a readiness gate."""

    if not settings.otel_enabled:
        return False
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        return False

    current = trace.get_tracer_provider()
    if not isinstance(current, TracerProvider):
        provider = TracerProvider(
            resource=Resource.create(
                {
                    "service.name": settings.otel_service_name,
                    "service.version": "2.0.0",
                    "deployment.environment": settings.environment,
                }
            )
        )
        if settings.otel_exporter_otlp_endpoint:
            endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/")
            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
            )
        trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, excluded_urls="/health/live,/health/ready")
    if not HTTPXClientInstrumentor().is_instrumented_by_opentelemetry:
        HTTPXClientInstrumentor().instrument()
    return True


def current_trace_id() -> str | None:
    try:
        from opentelemetry import trace
    except ImportError:
        return None
    context = trace.get_current_span().get_span_context()
    if not context.is_valid:
        return None
    return f"{context.trace_id:032x}"
