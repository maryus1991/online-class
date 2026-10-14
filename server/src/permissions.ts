import { timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { cleanText } from "./chat.ts";
import type { Role } from "./rooms.ts";

export interface AuthResult {
  ok: true;
  role: Role;
  roomId: string;
  name: string;
  clientId: string;
  title: string;
}
export interface AuthFail {
  ok: false;
  code: string;
  message: string;
}

const ROOM_RE = /^[A-Za-z0-9_-]{3,72}$/;
const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * نقطهٔ اتصال به سامانهٔ احراز هویت بیرونی.
 *
 * ⚠ حالت «dev» فقط برای توسعه و آزمایش است: استاد با یک کلید مشترک (TEACHER_KEY) شناخته می‌شود.
 * در آینده می‌توان این تابع را طوری تغییر داد که به‌جای کلید، یک توکن امضاشده (مثلاً JWT) از سامانهٔ بیرونی
 * را بررسی کند و role / roomId / name را از آن بگیرد؛ بقیهٔ کد فقط به نتیجهٔ این تابع تکیه دارد.
 */
export function authenticate(msg: any): AuthResult | AuthFail {
  const roomId = typeof msg?.room === "string" ? msg.room : "";
  if (!ROOM_RE.test(roomId)) return { ok: false, code: "bad-room", message: "کد کلاس نامعتبر است (۳ تا ۴۰ حرف انگلیسی، عدد، - یا _)" };
  const clientId = typeof msg?.clientId === "string" ? msg.clientId : "";
  if (!CLIENT_RE.test(clientId)) return { ok: false, code: "bad-client", message: "شناسهٔ مرورگر نامعتبر است" };
  const name = cleanText(msg?.name, config.limits.nameMaxLength);
  if (!name) return { ok: false, code: "bad-name", message: "نام نمایشی را وارد کنید" };
  const role: Role = msg?.role === "teacher" ? "teacher" : "student";
  if (role === "teacher") {
    const key = typeof msg?.key === "string" ? msg.key : "";
    if (!key || !safeEqual(key, config.auth.teacherKey)) {
      return { ok: false, code: "forbidden", message: "کلید استاد درست نیست" };
    }
  }
  const title = cleanText(msg?.title, config.limits.titleMaxLength) || "کلاس زنده";
  return { ok: true, role, roomId, name, clientId, title };
}

/** پیام‌هایی که فقط استاد مجاز به ارسال آن‌هاست. */
export const TEACHER_ONLY = new Set([
  "setMode",
  "boardInfo",
  "setChat",
  "qCreate",
  "qClose",
  "qResults",
  "qClear",
  "handResolve",
  "setSpeak",
  "endClass",
]);
export const STUDENT_ONLY = new Set(["qAnswer", "raiseHand"]);

export function originAllowed(origin: string | null | undefined): boolean {
  if (config.allowedOrigins.length === 0) return true;
  return Boolean(origin) && config.allowedOrigins.includes(origin!);
}
