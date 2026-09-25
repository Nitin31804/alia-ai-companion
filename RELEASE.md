# Release preparation

## Free interview demo

The root `Dockerfile` has been verified on Back4App, serving the compiled React application
and FastAPI/WebSocket API from one managed HTTPS origin. The root page, `/health` response,
configured Groq provider, beta gate, and security headers were verified on September 25,
2026.

Set `GROQ_API_KEY`, an exact `ALLOWED_ORIGINS` host, and a random
32-character-or-longer `BETA_ACCESS_TOKEN` in the Back4App container environment. The
demo stores `/tmp/alia/alia.db` on ephemeral storage; history can disappear after a
restart or redeploy. Back4App's free preview URL rotates and expires after 60 minutes, so
redeploy immediately before a demonstration and do not use it as a permanent resume link.
The API accepts its own HTTPS host in addition to configured origins, avoiding a second
configuration deploy when the preview address rotates. Do not present this setup as
durable production hosting.

`render.yaml` remains a tested alternative deployment definition and uses the same root
`Dockerfile`; it is not the active hosting platform.

The repository includes `docs/alia-deployment-demo.mp4`, a 64-second recording of the
temporary HTTPS deployment exercising streamed text chat and voice/avatar mode. Treat the
recording as reproducible demonstration evidence, not as proof of permanent availability.

## Current release scope

This version supports an invitation-only deployed web beta with browser-scoped histories
and a shared beta access code. It is not yet a general multi-user account service or a
store-ready Android release.

## Production configuration

1. Copy `.env.example` to `.env`, then set real `GROQ_API_KEY` and `GROQ_MODEL` values. Set `GEMINI_API_KEY` and `GEMINI_MODEL` only if image understanding will be offered. Choose `ALIA_RETENTION_DAYS` explicitly; the default is 30 days.
2. Generate a random `BETA_ACCESS_TOKEN` of at least 32 characters, keep it out of Git, and share it only with invited testers. Never put server keys or the beta access token into `VITE_*` variables. Testers enter the code in Settings. Changing the token revokes new connections; restart the API to close existing connections.
3. Point your domain's DNS at the deployment host. Open ports 80 and 443 for Caddy's HTTPS certificate flow. Keep port 8000 internal.
4. Set `APP_DOMAIN` in your deployment environment, then run the commands below from the repository root.

```powershell
$env:APP_DOMAIN = 'your-real-domain.example'
docker compose -f compose.production.yml config --quiet
docker compose -f compose.production.yml build
docker compose -f compose.production.yml up -d
```

The production compose file enables `APP_ENV=production`, requires an exact HTTPS origin, and fails startup if the beta token or Groq key is missing. Caddy serves the built frontend, proxies WebSockets, adds security headers, and manages HTTPS. `backend/.env` is excluded from image build contexts. SQLite and Caddy data live in named volumes. Do not use `docker compose down -v` unless you intend to erase those volumes.

Use one API worker/replica. Limits and active-conversation locks are in memory. The direct internal proxy address is used for the daily IP quota, so the reverse-proxied beta shares the 500-turn daily limit. Do not trust arbitrary forwarded headers to bypass that limit. Before scaling, implement shared limits and verified proxy client addresses with infrastructure you control. Limits reset on process restart.

## Release checks

- Run the API test suite, lint, and frontend production build. Test the deployed `/health` endpoint through HTTPS.
- Exercise real provider chat, image upload, voice playback, interruption, refresh/reconnect, retry, and deletion using test conversations.
- Test the supported desktop/mobile browsers on physical devices. Microphone/camera need HTTPS outside localhost. Capacitor's native WebView origin must be explicitly configured for a native release, along with its remote secure WebSocket endpoint.
- Set provider budgets and alerts. Replace the shared invite code with managed authentication, revocable user access, and durable per-user quotas before an open public launch.
- Verify the right to distribute `frontend/public/model.vrm`, portrait images, and other bundled assets; retain required attribution. A reference or downloaded asset is not proof of distribution rights.
- Publish operator identity, support contact, privacy notice, terms, retention/deletion policy, and the intended audience. The in-app data notice describes implemented behavior; it is not a substitute for your operator-specific published policies.
- Verify the configured retention interval and document how encrypted backups are expired when users delete conversations.
- Define encrypted backup storage, retention, deletion propagation, restore procedures, and monitoring. Test restoring a copy, not the live database. SQLite's backup API can make a consistent snapshot while running; a simple copy of only `alia.db` during WAL activity is not a reliable backup.
- Confirm your chosen speech provider's commercial usage, support, and availability suit the release. Native signing, app-store declarations, and device testing are separate release work.

## Operational behavior

- A failed or cancelled provider turn is not committed to server history. The browser retains the visible partial reply and offers retry.
- Retrying a completed request returns its saved text without creating a second turn. Voice can be regenerated separately as part of retry.
- Text completion is independent of TTS: a voice-provider failure does not replace a successful text reply with an error.
- Disconnect cancels the connection's active generation and releases its lock. Starting a second request while one runs returns a terminal busy error instead of silently cancelling the first.
- Delete requires an authenticated connection and targets only that browser identity. It returns an acknowledgement before the frontend removes its local conversation. Other browser identities cannot delete that history.
- No automatic notification requests or scheduled check-ins are made on startup.
- Changing the server address creates a separate identity and workspace for that address. The production CSP intentionally restricts connections to the deployed origin.

## Remaining public-launch decisions

Choose your domain/hosting account, managed authentication provider, support address, retention period, commercial speech provider, supported platforms, and approved/licensed visual assets. These cannot be truthfully replaced with sample credentials or invented policies.
