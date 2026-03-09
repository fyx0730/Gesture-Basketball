#!/usr/bin/env bash
set -euo pipefail

# Raspberry Pi local runtime health check for basketball-frvr.
#
# Usage:
#   bash scripts/pi-healthcheck.sh
#
# Optional:
#   BASE_URL=http://127.0.0.1:8000 bash scripts/pi-healthcheck.sh
#   BASE_URL=http://127.0.0.1 bash scripts/pi-healthcheck.sh

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
INDEX_URL="${BASE_URL%/}/index.html"
EXTERNAL_URL="${BASE_URL%/}/v/1576154515838/external.js"
FRAME_URL="${BASE_URL%/}/frame.html"

pass() { printf "[OK] %s\n" "$1"; }
warn() { printf "[WARN] %s\n" "$1"; }
fail() { printf "[FAIL] %s\n" "$1"; }

section() {
  echo
  echo "== $1 =="
}

http_code() {
  curl -sS -o /dev/null -w "%{http_code}" "$1"
}

content_type() {
  curl -sSI "$1" | awk -F': ' 'tolower($1)=="content-type"{print tolower($2)}' | tr -d '\r'
}

body_prefix() {
  curl -sS "$1" | head -c 200 || true
}

section "Environment"
echo "PWD: $(pwd)"
echo "BASE_URL: ${BASE_URL}"
echo "Date: $(date)"

section "Port Listeners"
if command -v lsof >/dev/null 2>&1; then
  lsof -i :80 -nP 2>/dev/null || true
  lsof -i :8000 -nP 2>/dev/null || true
else
  warn "lsof not found; skip port listener details."
fi

section "HTTP Status"
for u in "${INDEX_URL}" "${FRAME_URL}" "${EXTERNAL_URL}"; do
  code="$(http_code "$u" || true)"
  if [[ "${code}" == "200" ]]; then
    pass "${u} -> ${code}"
  else
    fail "${u} -> ${code}"
  fi
done

section "Content-Type Checks"
idx_ct="$(content_type "${INDEX_URL}" || true)"
ext_ct="$(content_type "${EXTERNAL_URL}" || true)"
echo "index.html content-type : ${idx_ct:-<none>}"
echo "external.js content-type: ${ext_ct:-<none>}"

if [[ "${idx_ct}" == *"text/html"* ]]; then
  pass "index.html content-type is HTML"
else
  warn "index.html content-type is unusual"
fi

if [[ "${ext_ct}" == *"javascript"* || "${ext_ct}" == *"text/plain"* || "${ext_ct}" == *"application/octet-stream"* ]]; then
  pass "external.js content-type looks acceptable"
else
  warn "external.js content-type is unusual"
fi

section "Response Body Sanity"
idx_prefix="$(body_prefix "${INDEX_URL}")"
ext_prefix="$(body_prefix "${EXTERNAL_URL}")"

if echo "${idx_prefix}" | rg -q "<!DOCTYPE html>|<html"; then
  pass "index.html body looks like HTML"
else
  warn "index.html body does not look like normal HTML"
fi

if echo "${ext_prefix}" | rg -q "^!function|^\\(function|var |function "; then
  pass "external.js body looks like JavaScript"
else
  fail "external.js body does NOT look like JavaScript"
fi

if echo "${ext_prefix}" | rg -qi "readme|^# |<html|<body|markdown"; then
  fail "external.js appears to contain markdown/html text"
else
  pass "external.js does not look like markdown/html"
fi

section "Key Resource Checks"
resources=(
  "${BASE_URL%/}/js/gesture-plugin.js"
  "${BASE_URL%/}/vendor/mediapipe/hands/hands.js"
  "${BASE_URL%/}/vendor/mediapipe/camera_utils/camera_utils.js"
  "${BASE_URL%/}/v/1576154515838/i/s/music.mp3"
)

for u in "${resources[@]}"; do
  code="$(http_code "$u" || true)"
  if [[ "${code}" == "200" ]]; then
    pass "${u} -> ${code}"
  else
    fail "${u} -> ${code}"
  fi
done

echo
echo "Health check finished."
echo "If any [FAIL] exists, first verify:"
echo "1) service root directory is the project root"
echo "2) browser URL is index.html (not stale cached URL)"
echo "3) only one server is serving the port"
