# Single image for both Cloud Run services; APP_MODULE selects which one.
#   webhook -> webhook.main:app     ui -> ui.main:app
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config.py ./
COPY ingestion ./ingestion
COPY agent ./agent
COPY webhook ./webhook
COPY ui ./ui

ENV APP_MODULE=ui.main:app
# Cloud Run injects PORT (default 8080).
CMD exec uvicorn "$APP_MODULE" --host 0.0.0.0 --port "${PORT:-8080}"
