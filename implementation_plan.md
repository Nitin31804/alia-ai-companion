# Phase 4 – Memory & Database Integration

**Goal**: Enable long‑term conversational memory by storing each interaction (user text + assistant response) as a vector embedding in MongoDB and retrieving the most relevant past turns to provide context to Gemini.

## Why this is needed
- The hub should remember earlier topics (e.g., "my Hangeul journal notes") across sessions.
- Vector search gives similarity‑based retrieval without handcrafted rules.

## What will be added / changed
1. **Environment variables** (`backend/.env`)
   - `MONGODB_URI` – MongoDB connection string (Atlas or local);
   - `MONGODB_DB` – Database name (default: `ai_companion`);
   - `MONGODB_COLLECTION` – Collection name (default: `conversations`).
2. **Python package** – `motor` (async MongoDB driver) already added to `requirements.txt`.
3. **New module** – `backend/db.py`
   - Async `init_db()` creates a global `MotorClient` and collection handle.
   - `store_interaction(user_text: str, ai_text: str, embedding: list[float])` stores a document:
     ```json
     {"user": ..., "assistant": ..., "embedding": ..., "timestamp": ISODate}
     ```
   - `retrieve_context(query_embedding, limit=5)` runs a `$vectorSearch` aggregation (MongoDB 6.0+ vector index) and returns the top‑k past `assistant` texts.
4. **Embedding generation** – Use Gemini’s `model.embed_content` utility (or the GenerativeModel’s `embed_content`) to obtain a 768‑dim vector for the user prompt.
5. **Main server (`main.py`) modifications**
   - After receiving a user message, compute its embedding.
   - Pull relevant past snippets via `retrieve_context` and prepend them to the prompt sent to Gemini.
   - After Gemini replies, store both user and assistant texts with the same embedding (or embed the assistant reply as well for richer retrieval).
   - Ensure all DB calls are `await`‑ed and non‑blocking.
6. **Graceful fallback** – If `MONGODB_URI` is missing or connection fails, the server will continue functioning without memory (log a warning).

## Open questions (needs your input)
> [!IMPORTANT] **MongoDB deployment** – Do you have an existing Atlas URI or a local MongoDB instance? If you prefer a local Docker container, let me know so I can add a `docker-compose.yml` snippet.
> 
> > `MONGODB_URI=` (e.g., `mongodb+srv://user:pwd@cluster0.mongodb.net/?retryWrites=true&w=majority`)
>
> **Embedding size** – Gemini’s embed API currently returns 768‑dim vectors. If you prefer a different model (e.g., `text-embedding-ada-002`), confirm.
>
> **Retention policy** – How many interactions should we keep? (e.g., prune after 10 k docs). I can add a simple TTL index if you need.

## Proposed implementation steps
- **Step 1**: Write `.env` placeholders.
- **Step 2**: Add `backend/db.py` with async init and helper functions.
- **Step 3**: Update `main.py` to import `db`, compute embeddings, retrieve context, store after response.
- **Step 4**: Add simple error handling and logs.
- **Step 5**: Test manually: send a few messages, restart server, verify that the assistant references earlier content.

## Verification plan
- Unit‑style test: start server, send three messages with the vision flag off, then send a fourth that asks about earlier content; the reply should include the earlier excerpt.
- Check MongoDB collection to see documents created and that the `_id` and `embedding` fields exist.
- Ensure the server still works if `MONGODB_URI` is left empty (should emit a warning and skip memory).

Once you approve the plan (or modify any of the open questions), I will proceed with the code changes.
