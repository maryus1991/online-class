import { config } from "./config.ts";
import { newId, type Peer, type Room } from "./rooms.ts";

export interface ChatMessage {
  id: string;
  kind: "public" | "private" | "system";
  from?: { pid: string; name: string; role: string };
  to?: string;
  text: string;
  at: number;
}

export class ChatError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** متن پیام را پاکسازی می‌کند (حذف نویسه‌های کنترلی، محدودکردن طول). نمایش در مرورگر فقط با textContent انجام می‌شود. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u202A-\u202E]/g, "").trim().slice(0, max);
}

function takeToken(b: { tokens: number; ts: number }, capacity: number, perSec: number): boolean {
  const now = Date.now();
  b.tokens = Math.min(capacity, b.tokens + ((now - b.ts) / 1000) * perSec);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function systemMessage(room: Room, text: string): void {
  const msg: ChatMessage = { id: newId(), kind: "system", text, at: Date.now() };
  pushBuffer(room, msg);
  room.broadcast({ t: "chat", message: msg });
}

function pushBuffer(room: Room, msg: ChatMessage): void {
  const max = config.limits.chatBufferSize;
  if (max === 0) return;
  room.chatBuffer.push(msg);
  // بافر محدود و موقت در RAM
  if (room.chatBuffer.length > max) room.chatBuffer.splice(0, room.chatBuffer.length - max);
}

export function publicChat(room: Room, peer: Peer, rawText: unknown): void {
  if (peer.role === "student" && !room.chatEnabled) throw new ChatError("chat-disabled", "چت عمومی توسط استاد غیرفعال شده است");
  const text = cleanText(rawText, config.limits.chatMaxLength);
  if (!text) throw new ChatError("empty", "پیام خالی است");
  if (!takeToken(peer.chatBucket, 5, 1)) throw new ChatError("rate-limited", "پیام‌ها را کمی آهسته‌تر بفرستید");
  const msg: ChatMessage = {
    id: newId(),
    kind: "public",
    from: { pid: peer.pid, name: peer.name, role: peer.role },
    text,
    at: Date.now(),
  };
  pushBuffer(room, msg);
  room.broadcast({ t: "chat", message: msg });
}

/** پیام خصوصی فقط برای فرستنده و گیرندهٔ تأییدشده در سرور ارسال می‌شود. */
export function privateChat(room: Room, peer: Peer, rawText: unknown, toPid: unknown): void {
  const text = cleanText(rawText, config.limits.chatMaxLength);
  if (!text) throw new ChatError("empty", "پیام خالی است");
  let target: Peer | undefined;
  if (peer.role === "student") {
    target = room.teacher; // دانش‌آموز فقط می‌تواند به استاد پیام خصوصی بدهد
    if (!target) throw new ChatError("teacher-offline", "استاد در حال حاضر متصل نیست");
  } else {
    if (typeof toPid !== "string") throw new ChatError("bad-target", "گیرنده مشخص نیست");
    target = room.peers.get(toPid);
    if (!target || target.role !== "student") throw new ChatError("bad-target", "گیرنده در کلاس نیست");
  }
  if (!takeToken(peer.chatBucket, 5, 1)) throw new ChatError("rate-limited", "پیام‌ها را کمی آهسته‌تر بفرستید");
  const msg: ChatMessage = {
    id: newId(),
    kind: "private",
    from: { pid: peer.pid, name: peer.name, role: peer.role },
    to: target.pid,
    text,
    at: Date.now(),
  };
  room.send(peer, { t: "chat", message: msg });
  room.send(target, { t: "chat", message: msg });
}
