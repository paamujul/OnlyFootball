# Build context is the REPO ROOT, not backend/ -- the SPA is baked into this
# image so FastAPI can serve it same-origin. Build with:
#   docker build -f backend/Dockerfile -t <image> .
# Every COPY below is therefore prefixed with backend/ or frontend/, and the
# root .dockerignore (not backend/.dockerignore) is the one that applies.

# --- SPA build stage --------------------------------------------------------
# Node 22 is pinned by frontend/.nvmrc and required by Vite 8.
FROM node:22-slim AS web
WORKDIR /web

# package*.json first so the dependency layer caches independently of source.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Deliberately NO VITE_API_BASE. The bundle is served by the same FastAPI
# process that serves /api, so src/api.ts's empty-string default (same-origin)
# is correct. Setting a base here would hard-code a hostname into the bundle.
RUN npm run build

# --- Runtime stage ----------------------------------------------------------
FROM python:3.12-slim

WORKDIR /app

# libgomp1: LightGBM's wheel links against OpenMP, which the slim image does not
# ship. Without it `import lightgbm` raises OSError (libgomp.so.1) and
# /api/coach/predict reports "no trained play-call model" even when the
# artifact is right there.
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini .

# Checked-in seed data (deploy/data/coaches.yml). app.config defaults DATA_DIR
# to <repo>/deploy/data, which does not exist inside the image -- without this
# COPY and the ENV below, sync_coaching_staff logs "missing seed file" on every
# refresh and /api/coach/* 404s with "no coaching staff on record".
COPY deploy/data ./data
ENV DATA_DIR=/app/data

# The built SPA: /app/static/index.html plus hashed assets in /app/static/assets.
# app.main mounts this at / and serves index.html for unknown paths so client
# -side routes survive a hard refresh. Copied before the chown below so the
# non-root user can read it.
COPY --from=web /web/dist ./static

# app.config mkdirs BOTH STORAGE_DIR and CACHE_DIR at import time (config.py
# lines 10-11), before anything gets a chance to handle the error. If either is
# missing and its parent is not writable by the running user, `import
# app.config` raises PermissionError. Create both here and hand them to the
# runtime user; a bind-mounted host volume over /app/storage must likewise
# be writable by uid 10001.
ENV STORAGE_DIR=/app/storage
ENV STATIC_DIR=/app/static
RUN useradd --system --create-home --uid 10001 nflapp \
    && mkdir -p "$STORAGE_DIR/cache" \
    && chown -R nflapp:nflapp /app
USER nflapp

# 8600 is default; PORT still wins if set in environment.
#
# `exec` ensures PID 1 is uvicorn so Docker signals (SIGTERM) are handled
# gracefully, allowing background ingesters and connections to drain cleanly.
EXPOSE 8600
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8600}"]
