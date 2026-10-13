import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

// همهٔ تنظیمات از متغیرهای محیطی خوانده می‌شوند (فایل .env.example را ببینید).
const env = process.env;

function int(name: string, def: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`متغیر محیطی ${name} نامعتبر است (${raw}). بازهٔ مجاز: ${min}..${max}`);
  }
  return n;
}

function list(name: string): string[] {
  return (env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

let iceServers: unknown[] = [];
if (env.ICE_SERVERS) {
  try {
    const parsed = JSON.parse(env.ICE_SERVERS);
    if (Array.isArray(parsed)) iceServers = parsed;
  } catch {
    throw new Error("ICE_SERVERS باید یک آرایهٔ JSON معتبر باشد.");
  }
}

// کلید استاد (فقط برای توسعه/آزمایش). اگر تنظیم نشود، هر بار هنگام راه‌اندازی یک کلید تصادفی ساخته و در لاگ چاپ می‌شود.
const teacherKeyProvided = Boolean(env.TEACHER_KEY);
const teacherKey = env.TEACHER_KEY || randomBytes(9).toString("base64url");

const workers = int("MEDIASOUP_WORKERS", Math.max(1, Math.min(os.cpus().length, 2)), 1, 32);
const rtcPortMin = int("RTC_PORT_MIN", 40000, 1024, 65000);

export const config = {
  host: env.HOST ?? "0.0.0.0",
  port: int("PORT", 3000, 1, 65535),
  clientDir: path.resolve(env.CLIENT_DIR ?? path.join(import.meta.dir, "../../client")),
  allowedOrigins: list("ALLOWED_ORIGINS"),

  auth: { mode: "dev" as const, teacherKey, teacherKeyProvided },

  mediasoup: {
    workers,
    logLevel: (env.MEDIASOUP_LOG_LEVEL ?? "warn") as "debug" | "warn" | "error" | "none",
    // هر Worker روی یک پورت UDP و TCP گوش می‌دهد: rtcPortMin + شمارهٔ worker
    rtcPortMin,
    rtcPortMax: rtcPortMin + workers - 1,
    listenIp: env.RTC_LISTEN_IP ?? "0.0.0.0",
    // آدرسی که به مرورگرها اعلام می‌شود؛ در سرور واقعی باید IP عمومی باشد.
    announcedAddress: env.RTC_ANNOUNCED_IP || "127.0.0.1",
    maxIncomingBitrate: int("MAX_INCOMING_BITRATE", 4_000_000, 100_000),
  },

  iceServers,

  limits: {
    maxRooms: int("MAX_ROOMS", 50, 1),
    maxPeersPerRoom: int("MAX_PEERS_PER_ROOM", 150, 2),
    maxSpeakers: int("MAX_SPEAKERS", 3, 1, 50),
    chatBufferSize: int("CHAT_BUFFER_SIZE", 50, 0, 500),
    chatMaxLength: int("CHAT_MAX_LENGTH", 500, 20, 5000),
    nameMaxLength: 40,
    titleMaxLength: 80,
    questionTextMax: 600,
    questionOptionMax: 120,
    answerMax: 500,
    questionImageMaxBytes: int("QUESTION_IMAGE_MAX_BYTES", 600_000, 10_000),
    maxMessageBytes: 1_048_576,
  },

  timing: {
    teacherGraceMs: int("TEACHER_GRACE_SEC", 90, 5) * 1000,
    heartbeatTimeoutMs: int("HEARTBEAT_TIMEOUT_SEC", 30, 10) * 1000,
    emptyRoomTtlMs: int("EMPTY_ROOM_TTL_SEC", 120, 10) * 1000,
    joinTimeoutMs: 10_000,
    sweepIntervalMs: 5_000,
  },
};

export function validateConfig(): void {
  if (config.mediasoup.rtcPortMax > 65535) throw new Error("محدودهٔ پورت RTC از 65535 بیشتر شد.");
}
