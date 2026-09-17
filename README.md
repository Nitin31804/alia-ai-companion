# Alia

A responsive AI companion with streaming chat, optional image understanding, browser/device dictation, and a 3D voice view. Release target: an invitation-only web beta.

## Run locally

Use Python 3.12 and Node 22.19 or later in the Node 22 line.

```powershell
cd backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

Configure `backend/.env` using `.env.example`. Keep an existing `.env`; do not overwrite your keys. `GROQ_API_KEY` enables chat. Set both `GEMINI_API_KEY` and `GEMINI_MODEL` to enable images. Select a model that your Google account currently supports; the app no longer hardcodes a retired vision model.

```powershell
# Terminal 1, in backend
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --ws-max-size 2000000

# Terminal 2, in frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Open http://127.0.0.1:5173. The frontend proxies `/ws/chat` and `/health` to port 8001. Override `ALIA_API_URL` in the frontend process environment to use a different API port. If Vite uses another port, also add that exact frontend origin to `ALLOWED_ORIGINS` on the backend and restart it.

## Features

- Drafts and images in IndexedDB; migration from the original localStorage chats after a successful save.
- Search, rename, export, server-confirmed delete, copy messages, retry failed/interrupted turns, and stop generation.
- Multiline messages, language preferences, voice replies, permission-triggered dictation, and camera capture in Live mode.
- Lazy-loaded 3D avatar, keyboard-accessible dialogs, responsive layout, and reduced-motion styles.
- Explicit AI identity, data-processing notice, and consent before sending a conversation.
- Browser-scoped private identities, beta access codes, origin validation, bounded messages, usage limits, cancellation, and health checks.

## Data model

The active API writes only completed turns to `backend/data/alia.db`. Records are scoped to a SHA-256 digest of a random 256-bit browser secret. Request IDs make retries of completed turns idempotent. Image descriptions can appear in server history; image bytes are not stored there. Text is not written to general application logs.

This is a device identity, not a user account. There is no password reset, multi-device sync, or server recovery after browser storage is cleared. The export contains conversation content, not identity secrets or access codes. Beta access codes stay in page memory and must be re-entered after reload.

The older `backend/memory.db`, `backend/data/chats.jsonl`, and optional MongoDB records are legacy archives. They are deliberately not automatically deleted or assigned to new owners. The old `database.py`, `db.py`, `react_agent.py`, and `test_memory.py` are no longer imported by the running app. Their optional dependencies are not in the active requirements. Review and retire legacy archives before any public launch. The new Delete action removes only that browser's conversation in the active database and its local copy. Backups and provider retention are separate.

## Verification

```powershell
cd backend
.\venv\Scripts\python.exe -m unittest test_app -v
cd ../frontend
npm run lint
npm run build
```

API tests replace providers with deterministic stubs and use temporary SQLite databases. They cover error completion, cancellation, request idempotency, ownership/deletion, origin/access checks, voice failure, and message/usage limits. They do not consume provider credits.

## Deployment

See [RELEASE.md](RELEASE.md) for the HTTPS Docker deployment, configuration, beta limitations, and remaining public-launch decisions.

Image handling uses the Google [generateContent REST API](https://ai.google.dev/api/generate-content). Speech input depends on browser/device support; speech output is an external Edge TTS service and should be evaluated for your release's availability requirements.
