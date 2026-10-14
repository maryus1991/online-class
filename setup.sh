#!/usr/bin/env bash
# =============================================================================
#  setup.sh  —  راه‌اندازی پروداکشن کلاس آنلاین (mediasoup)
#  اجرا:  sudo bash setup.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. دسترسی root
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  err "این اسکریپت باید با root اجرا شود:  sudo bash setup.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}"

# ---------------------------------------------------------------------------
# 1. دریافت دامنه و IP
# ---------------------------------------------------------------------------
echo
echo "=============================================="
echo "  راه‌اندازی پروداکشن — کلاس آنلاین"
echo "=============================================="
echo

read -rp "دامنه را وارد کنید (مثال: class.example.com): " DOMAIN
DOMAIN="${DOMAIN// /}"
[[ -z "$DOMAIN" ]] && err "دامنه خالی است."

# تشخیص IP عمومی
read -rp "IP عمومی سرور را وارد کنید: " PUBLIC_IP

if [[ ! "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || \
   ! python3 -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1])' "$PUBLIC_IP" 2>/dev/null; then
    echo "[ERROR] آدرس IPv4 معتبر نیست."
    exit 1
fi


info "دامنه : ${DOMAIN}"
info "IP    : ${PUBLIC_IP}"
echo
read -rp "ادامه می‌دهید؟ [y/N] " CONFIRM
[[ "${CONFIRM,,}" != "y" && "${CONFIRM,,}" != "yes" ]] && { echo "لغو شد."; exit 0; }

# کلیدهای تصادفی
TEACHER_KEY="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
TURN_USER="turnuser"
TURN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)"
MONITOR_TOKEN="$(openssl rand -hex 16)"

# ---------------------------------------------------------------------------
# 2. نصب Docker + Compose
# ---------------------------------------------------------------------------
install_docker() {
  if command -v docker &>/dev/null; then
    ok "Docker از قبل نصب است: $(docker --version)"
  else
    info "نصب Docker..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    ok "Docker نصب شد."
  fi

  if docker compose version &>/dev/null; then
    ok "Docker Compose در دسترس است: $(docker compose version --short)"
  else
    err "docker compose پیدا نشد. نصب را دستی بررسی کنید."
  fi
}

install_docker

# ابزارهای کمکی
apt-get install -y -qq curl openssl python3 python3-pip python3-venv ufw 2>/dev/null || true

# ---------------------------------------------------------------------------
# 3. ساخت فایل‌های پیکربندی
# ---------------------------------------------------------------------------
info "ساخت فایل‌های پیکربندی..."

mkdir -p "${PROJECT_DIR}/nginx" "${PROJECT_DIR}/certs" "${PROJECT_DIR}/monitor"

# --- .env ---
cat > "${PROJECT_DIR}/.env" <<EOF
PORT=3000
TEACHER_KEY=${TEACHER_KEY}

RTC_ANNOUNCED_IP=${PUBLIC_IP}
RTC_LISTEN_IP=0.0.0.0

MEDIASOUP_WORKERS=8
RTC_PORT_MIN=40000
RTC_PORT_MAX=40007

ICE_SERVERS=[{"urls":"stun:${PUBLIC_IP}:3478"},{"urls":"turn:${PUBLIC_IP}:3478","username":"${TURN_USER}","credential":"${TURN_PASS}"}]

MAX_ROOMS=25
MAX_PEERS_PER_ROOM=50
MAX_SPEAKERS=5
CHAT_BUFFER_SIZE=50
TEACHER_GRACE_SEC=90
HEARTBEAT_TIMEOUT_SEC=30
EMPTY_ROOM_TTL_SEC=120

ALLOWED_ORIGINS=https://${DOMAIN}
EOF
ok ".env ساخته شد."

# --- docker-compose.prod.yaml ---
cat > "${PROJECT_DIR}/docker-compose.prod.yaml" <<EOF
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    network_mode: host
    environment:
      PORT: "3000"
      NODE_ENV: production
    depends_on:
      - coturn

  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    network_mode: host
    environment:
      - DETECT_EXTERNAL_IP=yes
      - DETECT_RELAY_IP=yes
    command: >
      --log-file=stdout
      --lt-cred-mech
      --fingerprint
      --no-multicast-peers
      --realm=${DOMAIN}
      --user=${TURN_USER}:${TURN_PASS}
      --min-port=49160
      --max-port=49300
      --listening-port=3478
      --external-ip=${PUBLIC_IP}
      --listening-ip=0.0.0.0
      --relay-ip=${PUBLIC_IP}

  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - app

  monitor:
    build: ./monitor
    restart: unless-stopped
    network_mode: host
    environment:
      MONITOR_PORT: "9090"
      MONITOR_TOKEN: "${MONITOR_TOKEN}"
      MAX_CPU_PERCENT: "90"
      MAX_RAM_PERCENT: "85"
      MAX_DISK_PERCENT: "90"
      # ظرفیت طراحی‌شده برای این سرور (کلاس ۳۰ نفره)
      MAX_ROOMS: "25"
      MAX_PEERS_PER_ROOM: "35"
      BANDWIDTH_GBPS: "2.5"
EOF
ok "docker-compose.prod.yaml ساخته شد."

# --- nginx.conf ---
cat > "${PROJECT_DIR}/nginx/nginx.conf" <<EOF
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
  worker_connections 4096;
  use epoll;
  multi_accept on;
}

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;

  sendfile on;
  tcp_nopush on;
  tcp_nodelay on;
  keepalive_timeout 65;
  client_max_body_size 2m;

  gzip on;
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

  access_log /var/log/nginx/access.log combined buffer=32k flush=5s;

  upstream class_backend {
    server 127.0.0.1:3000;
    keepalive 32;
  }

  upstream monitor_backend {
    server 127.0.0.1:9090;
    keepalive 8;
  }

  # HTTP → HTTPS
  server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
      root /var/www/certbot;
    }

    location / {
      return 301 https://\$host\$request_uri;
    }
  }

  # HTTPS
  server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
      proxy_pass http://class_backend;
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
      proxy_connect_timeout 10s;
      proxy_buffering off;
    }

    # مانیتور منابع (نیاز به توکن)
    location /monitor/ {
      proxy_pass http://monitor_backend/;
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$scheme;
    }
  }
}
EOF
ok "nginx.conf ساخته شد."

# --- سرویس مانیتور Python ---
cat > "${PROJECT_DIR}/monitor/Dockerfile" <<'EOF'
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 9090
CMD ["python", "-u", "app.py"]
EOF

cat > "${PROJECT_DIR}/monitor/requirements.txt" <<'EOF'
psutil==6.1.0
EOF

cat > "${PROJECT_DIR}/monitor/app.py" <<'PYEOF'
#!/usr/bin/env python3
"""سرویس مانیتور منابع سرور — خروجی JSON"""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

import psutil

PORT = int(os.environ.get("MONITOR_PORT", "9090"))
TOKEN = os.environ.get("MONITOR_TOKEN", "")
MAX_CPU = float(os.environ.get("MAX_CPU_PERCENT", "90"))
MAX_RAM = float(os.environ.get("MAX_RAM_PERCENT", "85"))
MAX_DISK = float(os.environ.get("MAX_DISK_PERCENT", "90"))
MAX_ROOMS = int(os.environ.get("MAX_ROOMS", "25"))
MAX_PEERS = int(os.environ.get("MAX_PEERS_PER_ROOM", "35"))
BANDWIDTH_GBPS = float(os.environ.get("BANDWIDTH_GBPS", "2.5"))

# شمارنده شبکه برای محاسبه نرخ
_prev_net = psutil.net_io_counters()
_prev_time = time.time()


def collect():
    global _prev_net, _prev_time

    # CPU
    cpu_percent = psutil.cpu_percent(interval=0.5)
    cpu_count = psutil.cpu_count(logical=True)

    # RAM
    mem = psutil.virtual_memory()

    # Disk
    disk = psutil.disk_usage("/")

    # Network rate
    now = time.time()
    net = psutil.net_io_counters()
    dt = max(now - _prev_time, 0.001)
    sent_mbps = (net.bytes_sent - _prev_net.bytes_sent) * 8 / dt / 1_000_000
    recv_mbps = (net.bytes_recv - _prev_net.bytes_recv) * 8 / dt / 1_000_000
    _prev_net = net
    _prev_time = now

    bandwidth_max_mbps = BANDWIDTH_GBPS * 1000
    bandwidth_used_pct = round(min(100.0, (sent_mbps / bandwidth_max_mbps) * 100), 2) if bandwidth_max_mbps else 0

    # Load average
    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        load1 = load5 = load15 = 0.0

    # وضعیت سلامت
    alerts = []
    if cpu_percent >= MAX_CPU:
        alerts.append({"type": "cpu", "message": f"CPU بالای {MAX_CPU}%", "value": cpu_percent})
    if mem.percent >= MAX_RAM:
        alerts.append({"type": "ram", "message": f"RAM بالای {MAX_RAM}%", "value": mem.percent})
    if disk.percent >= MAX_DISK:
        alerts.append({"type": "disk", "message": f"دیسک بالای {MAX_DISK}%", "value": disk.percent})
    if bandwidth_used_pct >= 80:
        alerts.append({"type": "bandwidth", "message": "پهنای باند خروجی بالای ۸۰٪", "value": bandwidth_used_pct})

    status = "critical" if any(a["type"] in ("cpu", "ram") and a["value"] >= 95 for a in alerts) else (
        "warning" if alerts else "ok"
    )

    return {
        "status": status,
        "timestamp": int(time.time()),
        "hostname": os.uname().nodename,
        "cpu": {
            "percent": round(cpu_percent, 2),
            "cores": cpu_count,
            "max_percent": MAX_CPU,
            "usage_of_max": round(cpu_percent / MAX_CPU * 100, 2) if MAX_CPU else 0,
            "load_avg": {"1m": round(load1, 2), "5m": round(load5, 2), "15m": round(load15, 2)},
        },
        "memory": {
            "percent": round(mem.percent, 2),
            "used_gb": round(mem.used / (1024**3), 2),
            "total_gb": round(mem.total / (1024**3), 2),
            "available_gb": round(mem.available / (1024**3), 2),
            "max_percent": MAX_RAM,
            "usage_of_max": round(mem.percent / MAX_RAM * 100, 2) if MAX_RAM else 0,
        },
        "disk": {
            "percent": round(disk.percent, 2),
            "used_gb": round(disk.used / (1024**3), 2),
            "total_gb": round(disk.total / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "max_percent": MAX_DISK,
            "usage_of_max": round(disk.percent / MAX_DISK * 100, 2) if MAX_DISK else 0,
        },
        "network": {
            "sent_mbps": round(sent_mbps, 2),
            "recv_mbps": round(recv_mbps, 2),
            "bandwidth_max_mbps": bandwidth_max_mbps,
            "bandwidth_used_percent": bandwidth_used_pct,
            "bytes_sent_total": net.bytes_sent,
            "bytes_recv_total": net.bytes_recv,
        },
        "capacity": {
            "max_rooms": MAX_ROOMS,
            "max_peers_per_room": MAX_PEERS,
            "max_total_peers_theoretical": MAX_ROOMS * MAX_PEERS,
            "note": "ظرفیت طراحی‌شده؛ مصرف واقعی به ترافیک رسانه بستگی دارد",
        },
        "alerts": alerts,
        "thresholds": {
            "cpu_max_percent": MAX_CPU,
            "ram_max_percent": MAX_RAM,
            "disk_max_percent": MAX_DISK,
        },
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # بی‌صدا

    def _check_token(self):
        if not TOKEN:
            return True
        qs = parse_qs(urlparse(self.path).query)
        auth = self.headers.get("Authorization", "")
        token_q = (qs.get("token") or [None])[0]
        if auth.startswith("Bearer "):
            return auth[7:] == TOKEN
        return token_q == TOKEN

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/") or "/"

        if path in ("/", "/health"):
            body = json.dumps({"ok": True, "service": "server-monitor"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path in ("/stats", "/metrics", "/resources"):
            if not self._check_token():
                body = json.dumps({"error": "unauthorized", "message": "توکن نامعتبر است"}).encode()
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            data = collect()
            body = json.dumps(data, ensure_ascii=False, indent=2).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        body = json.dumps({"error": "not_found"}).encode()
        self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Monitor listening on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
PYEOF
ok "سرویس مانیتور ساخته شد."

# ---------------------------------------------------------------------------
# 4. فایروال
# ---------------------------------------------------------------------------
info "تنظیم فایروال (ufw)..."
ufw --force enable 2>/dev/null || true
ufw allow 22/tcp   comment 'SSH' 2>/dev/null || true
ufw allow 80/tcp   comment 'HTTP' 2>/dev/null || true
ufw allow 443/tcp  comment 'HTTPS' 2>/dev/null || true
ufw allow 3478/tcp comment 'TURN TCP' 2>/dev/null || true
ufw allow 3478/udp comment 'TURN UDP' 2>/dev/null || true
ufw allow 40000:40007/tcp comment 'mediasoup TCP' 2>/dev/null || true
ufw allow 40000:40007/udp comment 'mediasoup UDP' 2>/dev/null || true
ufw allow 49160:49300/udp comment 'coturn relay' 2>/dev/null || true
# مانیتور فقط از localhost / از طریق nginx
ok "فایروال تنظیم شد."

# ---------------------------------------------------------------------------
# 5. گواهی SSL
# ---------------------------------------------------------------------------
mkdir -p /var/www/certbot
CERT_DIR="${PROJECT_DIR}/certs"

if [[ -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
  ok "گواهی SSL از قبل وجود دارد."
else
  info "دریافت گواهی Let's Encrypt برای ${DOMAIN}..."
  apt-get install -y -qq certbot 2>/dev/null || true

  # اگر پورت 80 آزاد باشد certbot standalone کار می‌کند
  if certbot certonly --standalone --non-interactive --agree-tos \
      --register-unsafely-without-email \
      -d "${DOMAIN}" 2>/dev/null; then
    cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${CERT_DIR}/"
    cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "${CERT_DIR}/"
    ok "گواهی SSL دریافت شد."
  else
    warn "دریافت خودکار SSL ناموفق بود. گواهی موقت (self-signed) ساخته می‌شود."
    warn "بعداً با certbot گواهی واقعی بگیرید."
    openssl req -x509 -nodes -days 90 -newkey rsa:2048 \
      -keyout "${CERT_DIR}/privkey.pem" \
      -out "${CERT_DIR}/fullchain.pem" \
      -subj "/CN=${DOMAIN}" 2>/dev/null
    ok "گواهی self-signed ساخته شد."
  fi
fi
chmod 644 "${CERT_DIR}/fullchain.pem"
chmod 600 "${CERT_DIR}/privkey.pem"

# ---------------------------------------------------------------------------
# 6. ساخت و اجرای کانتینرها
# ---------------------------------------------------------------------------
info "ساخت و اجرای سرویس‌ها..."
cd "${PROJECT_DIR}"

# اگر Dockerfile پروژه در همین پوشه نیست، هشدار بده
if [[ ! -f "${PROJECT_DIR}/Dockerfile" ]]; then
  warn "Dockerfile پروژه در ${PROJECT_DIR} پیدا نشد."
  warn "این اسکریپت را کنار Dockerfile اصلی پروژه اجرا کنید، یا مسیر را اصلاح کنید."
fi

docker compose -f docker-compose.prod.yaml up --build -d

# ---------------------------------------------------------------------------
# 7. خلاصه
# ---------------------------------------------------------------------------
echo
echo "=============================================="
echo -e "  ${GREEN}راه‌اندازی تمام شد${NC}"
echo "=============================================="
echo
echo "  دامنه        : https://${DOMAIN}"
echo "  IP عمومی    : ${PUBLIC_IP}"
echo "  استاد        : https://${DOMAIN}/teacher.html"
echo "  دانش‌آموز    : https://${DOMAIN}/student.html"
echo
echo "  TEACHER_KEY  : ${TEACHER_KEY}"
echo "  TURN user    : ${TURN_USER}"
echo "  TURN pass    : ${TURN_PASS}"
echo
echo "  مانیتور منابع:"
echo "    https://${DOMAIN}/monitor/stats?token=${MONITOR_TOKEN}"
echo "    یا:  curl -H 'Authorization: Bearer ${MONITOR_TOKEN}' https://${DOMAIN}/monitor/stats"
echo
echo "  توکن مانیتور : ${MONITOR_TOKEN}"
echo
echo "  دستورات مفید:"
echo "    docker compose -f docker-compose.prod.yaml logs -f"
echo "    docker compose -f docker-compose.prod.yaml ps"
echo "    docker compose -f docker-compose.prod.yaml restart"
echo
echo "  تمدید SSL (ماهانه):"
echo "    certbot renew && cp /etc/letsencrypt/live/${DOMAIN}/*.pem ${CERT_DIR}/ && docker compose -f docker-compose.prod.yaml restart nginx"
echo
echo "=============================================="

# ذخیره اطلاعات حساس
cat > "${PROJECT_DIR}/.credentials" <<EOF
DOMAIN=${DOMAIN}
PUBLIC_IP=${PUBLIC_IP}
TEACHER_KEY=${TEACHER_KEY}
TURN_USER=${TURN_USER}
TURN_PASS=${TURN_PASS}
MONITOR_TOKEN=${MONITOR_TOKEN}
EOF
chmod 600 "${PROJECT_DIR}/.credentials"
ok "اطلاعات در .credentials ذخیره شد (دسترسی فقط root)."
echo
