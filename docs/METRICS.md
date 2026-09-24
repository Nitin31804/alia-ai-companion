# Reproducing latency measurements

Alia exposes cumulative Prometheus metrics at `http://localhost:8000/metrics`. The
following procedure separates application behavior from an invented benchmark result.

## Controlled run

1. Record the date, operating system, CPU, memory, browser, network connection, selected
   provider models, and whether image or voice output is enabled.
2. Restart the backend to reset its in-process counters.
3. Send at least 20 representative prompts from one browser. Use a fixed prompt list and
   do not mix text-only, image, and voice samples in the same result group.
4. Save the raw metrics response immediately after the run:

   ```bash
   curl http://localhost:8000/metrics > alia-metrics.prom
   ```

5. Report the sample count together with the histogram buckets. Never report a percentile
   from one or two requests, and never describe local results as a production SLA.

## Relevant series

| Metric | Interpretation |
| --- | --- |
| `alia_speech_recognition_seconds` | Browser/device recognition duration reported with a voice turn |
| `alia_llm_first_token_seconds` | Time from the Groq request to the first streamed text chunk |
| `alia_llm_response_seconds` | Total Groq streaming duration |
| `alia_image_processing_seconds` | Gemini image-description duration |
| `alia_tts_generation_seconds` | Edge TTS audio-generation duration |
| `alia_provider_errors_total` | Provider failures grouped by the fixed stage name |
| `alia_chat_turns_total` | Completed, cancelled, and failed server turns |
| `alia_idempotent_retry_cache_hits_total` | Completed duplicate requests served from SQLite |
| `alia_websocket_connections` | Authenticated connections currently open |

The application never places prompts, response text, image contents, browser secrets, or
access codes in labels. Provider latency depends on model choice, region, quota, network,
and provider load, so this repository intentionally does not publish fabricated numbers.
