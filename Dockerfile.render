FROM node:22-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ALIA_STATIC_DIR=/app/static \
    ALIA_DB_PATH=/tmp/alia/alia.db
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home alia
COPY backend/main.py backend/storage.py backend/providers.py backend/observability.py ./
COPY --from=frontend-build /frontend/dist ./static
RUN mkdir -p /tmp/alia && chown -R alia:alia /tmp/alia
USER alia
EXPOSE 10000
CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port \"${PORT:-10000}\" --workers 1 --ws-max-size 2000000 --no-proxy-headers"]
