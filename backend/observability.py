"""Low-cardinality Prometheus metrics for the active request path."""

from prometheus_client import Counter, Gauge, Histogram

ACTIVE_CONNECTIONS = Gauge(
    "alia_websocket_connections",
    "Currently authenticated WebSocket connections",
)
CHAT_TURNS = Counter(
    "alia_chat_turns_total",
    "Chat turns by terminal result",
    ["status"],
)
CACHE_HITS = Counter(
    "alia_idempotent_retry_cache_hits_total",
    "Completed turns returned from the idempotency store",
)
PROVIDER_ERRORS = Counter(
    "alia_provider_errors_total",
    "External provider failures by stage",
    ["stage"],
)
SPEECH_RECOGNITION_SECONDS = Histogram(
    "alia_speech_recognition_seconds",
    "Client-reported speech recognition duration",
)
LLM_FIRST_TOKEN_SECONDS = Histogram(
    "alia_llm_first_token_seconds",
    "Time from provider request to the first streamed text token",
)
LLM_RESPONSE_SECONDS = Histogram(
    "alia_llm_response_seconds",
    "Total streamed LLM response time",
)
IMAGE_PROCESSING_SECONDS = Histogram(
    "alia_image_processing_seconds",
    "Gemini image-description request duration",
)
TTS_GENERATION_SECONDS = Histogram(
    "alia_tts_generation_seconds",
    "Edge TTS audio generation duration",
)
