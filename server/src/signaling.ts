import type { types as mt } from "mediasoup";
import { config } from "./config.ts";
import { log } from "./log.ts";
import { ChatError, cleanText, privateChat, publicChat, systemMessage } from "./chat.ts";
import { authenticate, originAllowed, STUDENT_ONLY, TEACHER_ONLY } from "./permissions.ts";
import {
  answerQuestion,
  clearQuestion,
  closeQuestion,
  createQuestion,
  QuestionError,
  setShowResults,
} from "./questions.ts";
import { getOrCreateRoom, newPeer, rooms, SOURCE_KIND, type Peer, type Room, type Socket, type Source } from "./rooms.ts";

class SigError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Conn {
  raw: Socket;
  peer?: Peer;
  room?: Room;
  joinTimer?: ReturnType<typeof setTimeout>;
  queue: Promise<void>;
}

const conns = new WeakMap<object, Conn>();
const MODES = new Set(["idle", "screen", "board"]);
const BOARD_KINDS = new Set(["board", "image", "pdf"]);
const TOOLS = new Set(["pen", "line", "rect", "ellipse", "arrow", "text", "eraser"]);

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

function takeToken(b: { tokens: number; ts: number }, cap: number, perSec: number): boolean {
  const now = Date.now();
  b.tokens = Math.min(cap, b.tokens + ((now - b.ts) / 1000) * perSec);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function raw(conn: Conn, obj: unknown) {
  try {
    conn.raw.send(JSON.stringify(obj));
  } catch {
    /* اتصال بسته شده است */
  }
}

// ───────────── چرخهٔ اتصال WebSocket ─────────────
export function onOpen(ws: Socket, origin?: string | null): void {
  if (!originAllowed(origin)) {
    ws.close(1008, "origin-not-allowed");
    return;
  }
  const conn: Conn = { raw: ws, queue: Promise.resolve() };
  conn.joinTimer = setTimeout(() => {
    if (!conn.peer) ws.close(4000, "join-timeout");
  }, config.timing.joinTimeoutMs);
  conns.set(ws, conn);
}

export function onMessage(ws: Socket, data: unknown): void {
  const conn = conns.get(ws);
  if (!conn) return;
  let msg: any;
  if (typeof data === "string") {
    if (data.length > config.limits.maxMessageBytes) return void ws.close(1009, "too-big");
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
  } else if (isObj(data) && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) {
    msg = data; // Elysia پیام JSON را خودش تبدیل کرده است
  } else {
    return;
  }
  if (!isObj(msg) || typeof msg.t !== "string") return;
  // پردازش پیام‌های هر اتصال به ترتیب انجام می‌شود تا شرایط رقابتی پیش نیاید.
  conn.queue = conn.queue.then(() => handle(conn, msg)).catch((e) => log.error("unhandled", e));
}

export function onClose(ws: Socket): void {
  const conn = conns.get(ws);
  if (!conn) return;
  if (conn.joinTimer) clearTimeout(conn.joinTimer);
  conns.delete(ws);
  const { peer, room } = conn;
  if (peer && room && room.peers.get(peer.pid) === peer) room.removePeer(peer);
}

async function handle(conn: Conn, msg: any): Promise<void> {
  const id = typeof msg.id === "number" ? msg.id : undefined;
  const reply = (ok: boolean, payload: unknown) => {
    if (id !== undefined) raw(conn, ok ? { t: "res", id, ok: true, data: payload } : { t: "res", id, ok: false, ...(payload as object) });
  };
  try {
    if (!conn.peer) {
      if (msg.t !== "join") return;
      reply(true, await join(conn, msg));
      return;
    }
    const { peer, room } = conn;
    if (!room || room.closed) return;
    peer.lastSeen = Date.now();
    if (!takeToken(peer.bucket, 60, 30)) throw new SigError("rate-limited", "تعداد درخواست‌ها بیش از حد مجاز است");
    if (TEACHER_ONLY.has(msg.t) && peer.role !== "teacher") throw new SigError("forbidden", "این کار فقط برای استاد مجاز است");
    if (STUDENT_ONLY.has(msg.t) && peer.role !== "student") throw new SigError("forbidden", "این کار فقط برای دانش‌آموز مجاز است");
    reply(true, (await dispatch(conn, peer, room, msg)) ?? {});
  } catch (e) {
    if (e instanceof SigError || e instanceof ChatError || e instanceof QuestionError) {
      reply(false, { error: e.code, message: e.message });
      if (!conn.peer && msg.t === "join") setTimeout(() => conn.raw.close(4003, e.code), 150);
    } else {
      log.error(`handler ${msg.t} failed`, e);
      reply(false, { error: "internal-error", message: "خطای داخلی سرور" });
    }
  }
}

async function join(conn: Conn, msg: any) {
  if (conn.peer) throw new SigError("already-joined", "قبلاً وارد شده‌اید");
  const auth = authenticate(msg);
  if (!auth.ok) throw new SigError(auth.code, auth.message);
  let room = rooms.get(auth.roomId);
  if (!room || room.closed) {
    if (auth.role !== "teacher") throw new SigError("room-not-found", "این کلاس هنوز توسط استاد شروع نشده است");
    if (rooms.size >= config.limits.maxRooms) throw new SigError("server-full", "ظرفیت سرور برای کلاس‌های هم‌زمان پر است");
    room = await getOrCreateRoom(auth.roomId, auth.title);
  }
  const sameClient = room.byClient.get(auth.clientId);
  if (auth.role === "teacher") {
    const t = room.teacher;
    if (t && t.clientId !== auth.clientId) throw new SigError("teacher-exists", "در این کلاس یک استاد متصل است");
  } else if (sameClient?.role === "teacher") {
    throw new SigError("bad-client", "شناسهٔ مرورگر نامعتبر است");
  }
  if (!sameClient && room.peers.size >= config.limits.maxPeersPerRoom) throw new SigError("room-full", "ظرفیت این کلاس تکمیل است");

  const peer = newPeer(auth.role, auth.name, auth.clientId, conn.raw);
  peer.ws = null; // تا پایان پاسخ ورود، رویدادهای دیگر برای او فرستاده نشود
  room.addPeer(peer);
  conn.peer = peer;
  conn.room = room;
  if (conn.joinTimer) clearTimeout(conn.joinTimer);
  const data = {
    pid: peer.pid,
    role: peer.role,
    name: peer.name,
    state: room.stateFor(peer),
    routerRtpCapabilities: room.media.router.rtpCapabilities,
    iceServers: config.iceServers,
  };
  queueMicrotask(() => {
    if (room!.peers.get(peer.pid) === peer) peer.ws = conn.raw;
  });
  return data;
}

function str(v: unknown, max: number): string {
  return cleanText(v, max);
}

async function dispatch(conn: Conn, peer: Peer, room: Room, msg: any): Promise<unknown> {
  switch (msg.t) {
    case "ping":
      return {};

    // ───────── رسانه ─────────
    case "createTransport": {
      const direction = msg.direction === "send" ? "send" : msg.direction === "recv" ? "recv" : null;
      if (!direction) throw new SigError("bad-request", "جهت Transport نامعتبر است");
      if (direction === "send" && peer.role === "student" && !peer.canSpeak) {
        throw new SigError("forbidden", "اجازهٔ صحبت ندارید");
      }
      try {
        return await room.createTransport(peer, direction);
      } catch (e) {
        if ((e as Error).message === "transport-exists") throw new SigError("transport-exists", "این Transport قبلاً ساخته شده است");
        throw e;
      }
    }
    case "connectTransport": {
      const t = typeof msg.transportId === "string" ? peer.transports.get(msg.transportId) : undefined;
      if (!t) throw new SigError("bad-transport", "Transport پیدا نشد");
      if (!isObj(msg.dtlsParameters)) throw new SigError("bad-request", "پارامتر DTLS نامعتبر است");
      try {
        await t.connect({ dtlsParameters: msg.dtlsParameters as mt.DtlsParameters });
      } catch (e) {
        throw new SigError("connect-failed", (e as Error).message);
      }
      return {};
    }
    case "setRtpCaps": {
      if (!isObj(msg.rtpCapabilities)) throw new SigError("bad-request", "RTP Capabilities نامعتبر است");
      peer.rtpCapabilities = msg.rtpCapabilities as mt.RtpCapabilities;
      await room.consumeAll(peer);
      return {};
    }
    case "produce": {
      const source = msg.source as Source;
      if (!(source in SOURCE_KIND)) throw new SigError("bad-request", "منبع رسانه نامعتبر است");
      const kind = SOURCE_KIND[source];
      if (msg.kind !== kind || !isObj(msg.rtpParameters) || typeof msg.transportId !== "string") {
        throw new SigError("bad-request", "پارامترهای تولید رسانه نامعتبرند");
      }
      // کنترل مجوز در سرور: دانش‌آموز فقط با اجازهٔ استاد می‌تواند صدا تولید کند.
      if (peer.role === "student") {
        if (source !== "mic") throw new SigError("forbidden", "دانش‌آموز فقط می‌تواند صدا ارسال کند");
        if (!peer.canSpeak) throw new SigError("forbidden", "اجازهٔ صحبت ندارید");
      }
      let producer: mt.Producer;
      try {
        producer = await room.produce(peer, msg.transportId, kind, msg.rtpParameters as mt.RtpParameters, source);
      } catch (e) {
        const m = (e as Error).message;
        if (m === "screen-not-active") throw new SigError("screen-not-active", "ابتدا اشتراک صفحه را شروع کنید");
        if (m === "bad-transport") throw new SigError("bad-transport", "Transport ارسال معتبر نیست");
        throw new SigError("produce-failed", m);
      }
      if (peer.role === "student" && !peer.canSpeak) {
        producer.close(); // مجوز هنگام ساخت لغو شده است
        throw new SigError("forbidden", "اجازهٔ صحبت لغو شد");
      }
      return { id: producer.id };
    }
    case "closeProducer": {
      const p = typeof msg.producerId === "string" ? peer.producers.get(msg.producerId) : undefined;
      if (p) room.closeProducer(peer, p, false);
      return {};
    }
    case "resumeConsumer": {
      const c = typeof msg.consumerId === "string" ? peer.consumers.get(msg.consumerId) : undefined;
      if (!c) throw new SigError("bad-consumer", "Consumer پیدا نشد");
      await c.resume();
      return {};
    }
    case "setMuted":
      peer.muted = Boolean(msg.muted);
      room.schedulePresence();
      return {};

    // ───────── کنترل استاد ─────────
    case "setMode": {
      if (!MODES.has(msg.mode)) throw new SigError("bad-request", "حالت نامعتبر است");
      room.setMode(msg.mode);
      return {};
    }
    case "boardInfo": {
      const kind = BOARD_KINDS.has(msg.kind) ? msg.kind : "board";
      const page = Number.isInteger(msg.page) ? Math.min(Math.max(msg.page, 1), 100000) : 1;
      const pages = Number.isInteger(msg.pages) ? Math.min(Math.max(msg.pages, 1), 100000) : 1;
      const tool = TOOLS.has(msg.tool) ? msg.tool : "pen";
      room.boardInfo = { kind, fileName: str(msg.fileName, 120), page, pages, tool };
      room.broadcast({ t: "boardInfo", info: room.boardInfo }, (p) => p !== peer);
      return {};
    }
    case "endClass":
      setTimeout(() => room.close("ended-by-teacher"), 30);
      return {};

    // ───────── چت ─────────
    case "chat":
      publicChat(room, peer, msg.text);
      return {};
    case "privateChat":
      privateChat(room, peer, msg.text, msg.to);
      return {};
    case "setChat": {
      room.chatEnabled = Boolean(msg.enabled);
      room.broadcast({ t: "chatEnabled", enabled: room.chatEnabled });
      systemMessage(room, room.chatEnabled ? "چت عمومی فعال شد" : "چت عمومی توسط استاد غیرفعال شد");
      return {};
    }

    // ───────── پرسش و پاسخ ─────────
    case "qCreate":
      createQuestion(room, msg.question);
      return {};
    case "qClose":
      closeQuestion(room);
      return {};
    case "qResults":
      setShowResults(room, Boolean(msg.show));
      return {};
    case "qClear":
      clearQuestion(room);
      return {};
    case "qAnswer":
      answerQuestion(room, peer, msg);
      return {};

    // ───────── دست بلند کردن و مجوز صحبت ─────────
    case "raiseHand": {
      const raised = Boolean(msg.raised);
      if (raised && peer.canSpeak) return {};
      if (peer.hand === raised) return {};
      peer.hand = raised;
      peer.handAt = Date.now();
      if (raised) room.teacher && room.send(room.teacher, { t: "handRaised", pid: peer.pid, name: peer.name });
      room.schedulePresence();
      return {};
    }
    case "handResolve": {
      const target = typeof msg.pid === "string" ? room.peers.get(msg.pid) : undefined;
      if (!target || target.role !== "student") throw new SigError("bad-target", "دانش‌آموز پیدا نشد");
      if (msg.action === "approve") {
        grant(room, target);
      } else {
        target.hand = false;
        room.send(target, { t: "handRejected" });
        room.schedulePresence();
      }
      return {};
    }
    case "setSpeak": {
      const target = typeof msg.pid === "string" ? room.peers.get(msg.pid) : undefined;
      if (!target || target.role !== "student") throw new SigError("bad-target", "دانش‌آموز پیدا نشد");
      if (msg.allowed) grant(room, target);
      else room.revokeSpeak(target);
      return {};
    }

    case "leave":
      setTimeout(() => conn.raw.close(1000, "leave"), 30);
      return {};
    default:
      throw new SigError("unknown-message", "پیام ناشناخته");
  }
}

function grant(room: Room, target: Peer): void {
  try {
    room.grantSpeak(target);
  } catch (e) {
    if ((e as Error).message === "max-speakers") {
      throw new SigError("max-speakers", `حداکثر ${config.limits.maxSpeakers} نفر هم‌زمان می‌توانند صحبت کنند`);
    }
    throw e;
  }
}
