#!/usr/bin/env bash
set -euo pipefail

# Raspberry Pi kiosk deploy for basketball-frvr (offline/local mode).
#
# Usage:
#   sudo bash scripts/deploy-pi-kiosk.sh
#
# Optional environment overrides:
#   PROJECT_DIR=/home/pi/basketball-frvr
#   APP_BASE_PATH=/
#   SITE_ROOT=/var/www/basketball-frvr
#   INSTALL_UNCLUTTER=1
#   RUN_OFFLINE_CHECK=1
#   AUTO_ALLOW_CAMERA=1

TARGET_USER="${SUDO_USER:-pi}"
if ! id "${TARGET_USER}" >/dev/null 2>&1; then
  TARGET_USER="pi"
fi
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"

PROJECT_DIR="${PROJECT_DIR:-${TARGET_HOME}/basketball-frvr}"
APP_BASE_PATH="${APP_BASE_PATH:-/}"
SITE_ROOT="${SITE_ROOT:-/var/www/basketball-frvr}"
INSTALL_UNCLUTTER="${INSTALL_UNCLUTTER:-1}"
RUN_OFFLINE_CHECK="${RUN_OFFLINE_CHECK:-1}"
AUTO_ALLOW_CAMERA="${AUTO_ALLOW_CAMERA:-1}"

if [[ "${APP_BASE_PATH}" != /* ]]; then
  APP_BASE_PATH="/${APP_BASE_PATH}"
fi
if [[ "${APP_BASE_PATH}" != "/" && "${APP_BASE_PATH}" != */ ]]; then
  APP_BASE_PATH="${APP_BASE_PATH}/"
fi

if [[ "${APP_BASE_PATH}" == "/" ]]; then
  KIOSK_PATH="/index.html"
else
  KIOSK_PATH="${APP_BASE_PATH}index.html"
fi
URL="http://127.0.0.1${KIOSK_PATH}"
NGINX_CONF="/etc/nginx/sites-available/basketball-frvr"
NGINX_LINK="/etc/nginx/sites-enabled/basketball-frvr"
CHROMIUM_USER_DATA="/tmp/chromium-kiosk-${TARGET_USER}"

if [[ "$EUID" -ne 0 ]]; then
  echo "Please run as root: sudo bash $0"
  exit 1
fi

if [[ ! -d "${PROJECT_DIR}" ]]; then
  echo "ERROR: project directory not found: ${PROJECT_DIR}"
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/index.html" ]]; then
  echo "ERROR: index.html not found under ${PROJECT_DIR}"
  exit 1
fi

echo "==> Target user: ${TARGET_USER}"
echo "==> Project dir: ${PROJECT_DIR}"
echo "==> Site root  : ${SITE_ROOT}"
echo "==> URL        : ${URL}"

if [[ "${RUN_OFFLINE_CHECK}" == "1" && -f "${PROJECT_DIR}/check-offline-readiness.py" ]]; then
  echo "==> Running offline readiness check..."
  python3 "${PROJECT_DIR}/check-offline-readiness.py"
fi

echo "==> Installing required packages..."
apt-get update -y
apt-get install -y nginx rsync
apt-get install -y python3 python3-venv python3-pip python3-opencv
if apt-cache show chromium >/dev/null 2>&1; then
  apt-get install -y chromium
elif apt-cache show chromium-browser >/dev/null 2>&1; then
  apt-get install -y chromium-browser
else
  echo "WARNING: chromium package not found in apt cache."
fi
if [[ "${INSTALL_UNCLUTTER}" == "1" ]]; then
  apt-get install -y unclutter || true
fi

if command -v chromium >/dev/null 2>&1; then
  CHROMIUM_BIN="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BIN="$(command -v chromium-browser)"
else
  echo "ERROR: chromium/chromium-browser not found after install."
  exit 1
fi

echo "==> Installing gesture daemon Python environment..."
if [[ -f "${PROJECT_DIR}/scripts/requirements-gesture-daemon.txt" ]]; then
  su - "${TARGET_USER}" -c "
    python3 -m venv \"${PROJECT_DIR}/.venv-gesture\"
    \"${PROJECT_DIR}/.venv-gesture/bin/pip\" install --upgrade pip
    \"${PROJECT_DIR}/.venv-gesture/bin/pip\" install -r \"${PROJECT_DIR}/scripts/requirements-gesture-daemon.txt\"
  "
fi

echo "==> Publishing project files..."
mkdir -p "${SITE_ROOT}"
rsync -a --delete \
  --exclude ".git" \
  --exclude ".tmp-mediapipe" \
  --exclude ".audio-download-tmp" \
  --exclude "node_modules" \
  --exclude "__pycache__" \
  --exclude "README.md" \
  "${PROJECT_DIR}/" "${SITE_ROOT}/"
chown -R www-data:www-data "${SITE_ROOT}"

echo "==> Writing nginx config..."
if [[ "${APP_BASE_PATH}" == "/" ]]; then
  cat > "${NGINX_CONF}" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${SITE_ROOT};
    index index.html;

    location ~* \.md$ {
        return 404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
else
  cat > "${NGINX_CONF}" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location ~* \.md$ {
        return 404;
    }

    location = / {
        return 302 ${APP_BASE_PATH};
    }

    location ^~ ${APP_BASE_PATH} {
        rewrite ^${APP_BASE_PATH}(.*)\$ /\$1 break;
        root ${SITE_ROOT};
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
fi

rm -f /etc/nginx/sites-enabled/default
ln -sf "${NGINX_CONF}" "${NGINX_LINK}"
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "==> Configuring gesture daemon service..."
cat > /etc/systemd/system/gesture-daemon.service <<EOF
[Unit]
Description=Basketball FRVR Gesture Daemon
After=network.target

[Service]
Type=simple
User=${TARGET_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${PROJECT_DIR}/.venv-gesture/bin/python3 ${PROJECT_DIR}/scripts/gesture-daemon.py
Restart=always
RestartSec=2
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gesture-daemon
systemctl restart gesture-daemon

echo "==> Enabling desktop autologin (best effort)..."
if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_boot_behaviour B4 || true
fi

echo "==> Configuring Chromium kiosk autostart..."
killall -9 chromium chromium-browser 2>/dev/null || true
rm -rf "${CHROMIUM_USER_DATA}"

CAMERA_FLAG=""
if [[ "${AUTO_ALLOW_CAMERA}" == "1" ]]; then
  CAMERA_FLAG="--use-fake-ui-for-media-stream"
fi

KIOSK_CMD="${CHROMIUM_BIN} --kiosk --incognito --user-data-dir=${CHROMIUM_USER_DATA} --no-first-run --disable-infobars --noerrdialogs --disable-session-crashed-bubble --disable-restore-session-state --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required ${CAMERA_FLAG} ${URL}"

AUTOSTART_DIR="${TARGET_HOME}/.config/lxsession/LXDE-pi"
AUTOSTART_FILE="${AUTOSTART_DIR}/autostart"
mkdir -p "${AUTOSTART_DIR}"
cat > "${AUTOSTART_FILE}" <<EOF
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0.5 -root
@sleep 5 && ${KIOSK_CMD}
EOF

AUTOSTART_DESKTOP_DIR="${TARGET_HOME}/.config/autostart"
mkdir -p "${AUTOSTART_DESKTOP_DIR}"
cat > "${AUTOSTART_DESKTOP_DIR}/basketball-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Basketball FRVR Kiosk
Exec=sh -c "sleep 5 && ${KIOSK_CMD}"
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

chown -R "${TARGET_USER}:${TARGET_USER}" "${TARGET_HOME}/.config"

echo
echo "========================================"
echo "Done! Basketball FRVR kiosk deployed."
echo "========================================"
echo "URL: ${URL}"
echo "Chromium: ${CHROMIUM_BIN}"
echo "Gesture daemon:"
echo "  - Service: gesture-daemon.service"
echo "  - WS: ws://127.0.0.1:8765"
echo "Autostart:"
echo "  - ${AUTOSTART_FILE}"
echo "  - ${AUTOSTART_DESKTOP_DIR}/basketball-kiosk.desktop"
echo
echo "Reboot to start kiosk mode:"
echo "  sudo reboot"
echo
echo "Manual test command:"
echo "  ${KIOSK_CMD}"
echo "========================================"
