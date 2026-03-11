#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HTTP_HOST="${HTTP_HOST:-127.0.0.1}"
HTTP_PORT="${HTTP_PORT:-8000}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found."
  exit 1
fi

echo "==> Project: ${ROOT_DIR}"
echo "==> Starting frontend dev server on ${HTTP_HOST}:${HTTP_PORT}"
echo "URL: http://${HTTP_HOST}:${HTTP_PORT}/index.html"
echo
python3 -m http.server "${HTTP_PORT}" --bind "${HTTP_HOST}" --directory "${ROOT_DIR}"
