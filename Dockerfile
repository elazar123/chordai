# ChordAI — a single image running the API, the analyzer and the built UI.
#
# Note: the image has no GPU access, so vocal separation falls back to CPU and is
# several times slower than on an Apple Silicon machine. Size the host accordingly
# (8+ cores recommended) or set CHORDAI_SEPARATE=false.

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python side first: these layers change far less often than the app code.
COPY analyzer/requirements.txt analyzer/requirements.txt
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir --upgrade pip \
    && .venv/bin/pip install --no-cache-dir -r analyzer/requirements.txt \
    && .venv/bin/pip install --no-cache-dir demucs "numpy<2" \
    && .venv/bin/pip install --no-cache-dir yt-dlp

COPY package*.json ./
RUN npm ci --omit=dev

COPY web/package*.json web/
RUN npm --prefix web ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=5178 \
    CHORDAI_PYTHON=/app/.venv/bin/python \
    CHORDAI_YTDLP=/app/.venv/bin/yt-dlp \
    CHORDAI_SEPARATION_DEVICE=cpu

# Songs and audio live here; mount a volume so they survive a redeploy.
VOLUME ["/app/data"]

EXPOSE 5178

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD curl -fs http://localhost:5178/api/health || exit 1

CMD ["node", "server/index.js"]
