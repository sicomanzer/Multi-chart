# Multi-chart trading desk — container image for Render, Railway, Fly, Docker.
#
# The app is not just Node: the MCP server and the fundamentals sidecar are both
# Python, and the sidecar is only ever used for the ratio strip. That is the whole
# reason this file exists — a stock `node:22` image has no python3, so the MCP
# spawns nothing and the board loads candles but never a quote.

FROM node:22-bookworm-slim

# A venv rather than a system pip: Debian marks /usr/lib/python3 externally
# managed, so a plain `pip install` refuses with PEP 668 and the build dies.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir tradingview-mcp-server

# detectPython() honours this before searching PATH.
ENV TVMCP_PYTHON=/opt/venv/bin/python

WORKDIR /app

# Dependencies first so an app-code change does not reinstall the world.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# data/ holds workspaces.json, written at runtime. Point DATA_DIR at a mounted
# volume to keep boards across deploys; otherwise they live as long as the
# container.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/app/data

EXPOSE 8787

# /api/health never touches the MCP, so this cannot hang on a Python subprocess
# and cannot be broken by DECK_PASSWORD (that route is exempt).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
