import path from "node:path";
import { Elysia } from "elysia";
import { config, validateConfig } from "./config.ts";
import { log } from "./log.ts";
import { initWorkers } from "./mediasoup.ts";
import { rooms } from "./rooms.ts";
import { onClose, onMessage, onOpen } from "./signaling.ts";
import { shutdown, startSweeper } from "./cleanup.ts";

validateConfig();
await initWorkers();

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

const baseHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(self), microphone=(self), display-capture=(self)",
};

async function serveStatic(rel: string): Promise<Response> {
  const root = config.clientDir;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const full = path.resolve(root, decoded);
  if (full !== root && !full.startsWith(root + path.sep)) return new Response("Forbidden", { status: 403 });
  const file = Bun.file(full);
  if (!(await file.exists()) || full === root) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = { ...baseHeaders };
  if (full.endsWith(".html")) {
    headers["Content-Security-Policy"] = CSP;
    headers["Cache-Control"] = "no-cache";
  } else {
    headers["Cache-Control"] = decoded.startsWith("vendor/") ? "public, max-age=86400" : "no-cache";
  }
  return new Response(file, { headers });
}

const app = new Elysia()
  .get("/healthz", () => ({ ok: true, rooms: rooms.size }))
  .get("/", () => new Response(null, { status: 302, headers: { Location: "/student.html" } }))
  .ws("/ws", {
    idleTimeout: 60,
    maxPayloadLength: config.limits.maxMessageBytes,
    open(ws) {
      const origin = (ws.data as any)?.headers?.origin ?? (ws.data as any)?.request?.headers?.get?.("origin");
      onOpen(ws.raw as any, origin);
    },
    message(ws, message) {
      onMessage(ws.raw as any, message);
    },
    close(ws) {
      onClose(ws.raw as any);
    },
  })
  .get("/*", ({ params }) => serveStatic((params as any)["*"] ?? ""))
  .listen({ hostname: config.host, port: config.port });

startSweeper();
shutdown(() => app.stop());

log.info(`server listening on http://${config.host}:${config.port}`);
log.info(`client dir: ${config.clientDir}`);
if (!config.auth.teacherKeyProvided) {
  log.warn(`TEACHER_KEY تنظیم نشده؛ کلید موقت این اجرا: ${config.auth.teacherKey}`);
}
if (config.mediasoup.announcedAddress === "127.0.0.1") {
  log.warn("RTC_ANNOUNCED_IP روی 127.0.0.1 است؛ فقط برای آزمایش روی همین دستگاه کار می‌کند.");
}
