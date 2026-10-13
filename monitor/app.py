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