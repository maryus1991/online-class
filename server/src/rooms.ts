import { randomBytes, randomUUID } from "node:crypto";
import type { types as mt } from "mediasoup";
import { config } from "./config.ts";
import { log } from "./log.ts";
import { createRoomMedia, type RoomMedia } from "./mediasoup.ts";
import { systemMessage, type ChatMessage } from "./chat.ts";
import { questionViewFor, type Question } from "./questions.ts";

export type Role = "teacher" | "student";
export type Mode = "idle" | "screen" | "board";
export type Source = "mic" | "camera" | "screen" | "screen-audio" | "board";
export type MediaState = "none" | "connecting" | "connected" | "disconnected";

export const SOURCE_KIND: Record<Source, "audio" | "video"> = {
  mic: "audio",
  "screen-audio": "audio",
  camera: "video",
  screen: "video",
  board: "video",
};
/** منبع‌هایی که به یکی از دو حالت جایگزین (اشتراک صفحه / تخته) تعلق دارند. */
const SOURCE_MODE: Partial<Record<Source, Mode>> = { screen: "screen", "screen-audio": "screen", board: "board" };

export interface Socket {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
}

export interface Peer {
  pid: string; // شناسهٔ عمومی (برای نمایش به دیگران)
  clientId: string; // شناسهٔ خصوصی مرورگر (هرگز برای دیگران ارسال نمی‌شود)
  role: Role;
  name: string;
  ws: Socket | null;
  joinedAt: number;
  lastSeen: number;
  canSpeak: boolean;
  hand: boolean;
  handAt: number;
  muted: boolean;
  media: MediaState;
  rtpCapabilities?: mt.RtpCapabilities;
  transports: Map<string, mt.WebRtcTransport>;
  producers: Map<string, mt.Producer>;
  consumers: Map<string, mt.Consumer>;
  bucket: { tokens: number; ts: number };
  chatBucket: { tokens: number; ts: number };
}

export interface BoardInfo {
  kind: "board" | "image" | "pdf";
  fileName: string;
  page: number;
  pages: number;
  tool: string;
}

export const rooms = new Map<string, Room>();
const creating = new Map<string, Promise<Room>>();

export function newPeer(role: Role, name: string, clientId: string, ws: Socket): Peer {
  const now = Date.now();
  return {
    pid: randomBytes(6).toString("base64url"),
    clientId,
    role,
    name,
    ws,
    joinedAt: now,
    lastSeen: now,
    canSpeak: false,
    hand: false,
    handAt: 0,
    muted: false,
    media: "none",
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    bucket: { tokens: 60, ts: now },
    chatBucket: { tokens: 5, ts: now },
  };
}

export async function getOrCreateRoom(id: string, title: string): Promise<Room> {
  const existing = rooms.get(id);
  if (existing && !existing.closed) return existing;
  const pending = creating.get(id);
  if (pending) return pending;
  const p = (async () => {
    const media = await createRoomMedia();
    const room = new Room(id, title, media);
    rooms.set(id, room);
    log.info(`room created: ${id}`);
    return room;
  })();
  creating.set(id, p);
  try {
    return await p;
  } finally {
    creating.delete(id);
  }
}

export class Room {
  peers = new Map<string, Peer>();
  byClient = new Map<string, Peer>();
  mode: Mode = "idle";
  chatEnabled = true;
  chatBuffer: ChatMessage[] = [];
  question: Question | null = null;
  boardInfo: BoardInfo = { kind: "board", fileName: "", page: 1, pages: 1, tool: "pen" };
  closed = false;
  emptySince: number | null = Date.now();
  teacherGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private questionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly id: string,
    public title: string,
    public readonly media: RoomMedia,
  ) {}

  get teacher(): Peer | undefined {
    for (const p of this.peers.values()) if (p.role === "teacher") return p;
    return undefined;
  }
  get students(): Peer[] {
    return [...this.peers.values()].filter((p) => p.role === "student");
  }
  get speakers(): Peer[] {
    return this.students.filter((p) => p.canSpeak);
  }

  // ───────────── ارسال پیام ─────────────
  send(peer: Peer, msg: unknown): void {
    if (!peer.ws) return;
    try {
      peer.ws.send(JSON.stringify(msg));
    } catch (e) {
      log.warn("send failed", (e as Error).message);
    }
  }
  broadcast(msg: unknown, filter?: (p: Peer) => boolean): void {
    const data = JSON.stringify(msg);
    for (const p of this.peers.values()) {
      if (filter && !filter(p)) continue;
      try {
        p.ws?.send(data);
      } catch {
        /* قطع‌شده؛ توسط close handler پاک می‌شود */
      }
    }
  }

  // ───────────── حضور ─────────────
  presenceFor(viewer: Peer) {
    const list = [...this.peers.values()].map((p) =>
      viewer.role === "teacher"
        ? {
            pid: p.pid,
            name: p.name,
            role: p.role,
            hand: p.hand,
            handAt: p.handAt,
            canSpeak: p.canSpeak,
            muted: p.muted,
            micLive: [...p.producers.values()].some((x) => x.appData.source === "mic"),
            media: p.media,
          }
        : { pid: p.pid, name: p.name, role: p.role, speaking: p.canSpeak && !p.muted },
    );
    return { list, students: this.students.length, teacherOnline: Boolean(this.teacher) };
  }
  /** تغییرات پشت‌سرهم حضور را جمع می‌کند تا پیام‌های اضافی ارسال نشود. */
  schedulePresence(): void {
    if (this.presenceTimer || this.closed) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      if (this.closed) return;
      for (const p of this.peers.values()) this.send(p, { t: "presence", ...this.presenceFor(p) });
    }, 120);
  }
  scheduleQuestionUpdate(): void {
    if (this.questionTimer || this.closed) return;
    this.questionTimer = setTimeout(() => {
      this.questionTimer = null;
      this.pushQuestion(false);
    }, 250);
  }
  /** سؤال فعلی را (با دید مخصوص هر نقش) برای همه می‌فرستد. */
  pushQuestion(full = true): void {
    if (this.closed) return;
    for (const p of this.peers.values()) {
      if (!full && p.role === "student" && !this.question?.showResults) continue;
      this.send(p, { t: "question", question: questionViewFor(this, p) });
    }
  }

  // ───────────── ورود و خروج ─────────────
  addPeer(peer: Peer): void {
    const old = this.byClient.get(peer.clientId);
    if (old) {
      // اتصال تازه با همان شناسه جایگزین اتصال قدیمی می‌شود.
      this.send(old, { t: "replaced" });
      const ws = old.ws;
      this.removePeer(old, true);
      try {
        ws?.close(4001, "replaced");
      } catch {
        /* ignore */
      }
    }
    this.peers.set(peer.pid, peer);
    this.byClient.set(peer.clientId, peer);
    this.emptySince = null;
    if (peer.role === "teacher") {
      if (this.teacherGraceTimer) clearTimeout(this.teacherGraceTimer);
      this.teacherGraceTimer = null;
      this.broadcast({ t: "teacherStatus", online: true }, (p) => p !== peer);
      systemMessage(this, `${peer.name} (استاد) وارد کلاس شد`);
    } else if (!old) {
      systemMessage(this, `${peer.name} وارد کلاس شد`);
    }
    this.schedulePresence();
  }

  removePeer(peer: Peer, silent = false): void {
    if (!this.peers.has(peer.pid)) return;
    this.peers.delete(peer.pid);
    if (this.byClient.get(peer.clientId) === peer) this.byClient.delete(peer.clientId);
    peer.ws = null;
    peer.hand = false;
    peer.canSpeak = false;
    // بستن Transport همهٔ Producerها و Consumerهای مربوط به آن را هم آزاد می‌کند.
    for (const t of peer.transports.values()) if (!t.closed) t.close();
    peer.transports.clear();
    peer.producers.clear();
    peer.consumers.clear();
    if (this.closed) return;
    if (!silent) {
      if (peer.role === "teacher") {
        systemMessage(this, `${peer.name} (استاد) از کلاس خارج شد`);
        this.broadcast({ t: "teacherStatus", online: false });
        this.startTeacherGrace();
      } else {
        systemMessage(this, `${peer.name} از کلاس خارج شد`);
        this.scheduleQuestionUpdate();
      }
    } else if (peer.role === "teacher") {
      this.startTeacherGrace();
    }
    if (this.peers.size === 0) this.emptySince = Date.now();
    this.schedulePresence();
  }

  private startTeacherGrace(): void {
    if (this.teacherGraceTimer) clearTimeout(this.teacherGraceTimer);
    this.teacherGraceTimer = setTimeout(() => this.close("teacher-timeout"), config.timing.teacherGraceMs);
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    log.info(`room closed: ${this.id} (${reason})`);
    this.broadcast({ t: "classEnded", reason });
    for (const p of this.peers.values()) {
      for (const t of p.transports.values()) if (!t.closed) t.close();
      p.transports.clear();
      p.producers.clear();
      p.consumers.clear();
      const ws = p.ws;
      p.ws = null;
      try {
        ws?.close(1000, "class-ended");
      } catch {
        /* ignore */
      }
    }
    this.peers.clear();
    this.byClient.clear();
    this.chatBuffer = [];
    this.question = null;
    for (const tm of [this.teacherGraceTimer, this.presenceTimer, this.questionTimer]) if (tm) clearTimeout(tm);
    this.media.release();
    rooms.delete(this.id);
  }

  // ───────────── رسانه ─────────────
  recvTransport(peer: Peer): mt.WebRtcTransport | undefined {
    for (const t of peer.transports.values()) if (t.appData.direction === "recv") return t;
    return undefined;
  }

  async createTransport(peer: Peer, direction: "send" | "recv") {
    for (const t of peer.transports.values()) {
      if (t.appData.direction === direction) throw new Error("transport-exists");
    }
    const transport = await this.media.router.createWebRtcTransport({
      webRtcServer: this.media.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      appData: { pid: peer.pid, direction },
    });
    peer.transports.set(transport.id, transport);
    if (direction === "send") {
      transport.setMaxIncomingBitrate(config.mediasoup.maxIncomingBitrate).catch(() => {});
    }
    const refresh = () => {
      const states = [...peer.transports.values()].map((t) => ({ ice: t.iceState, dtls: t.dtlsState }));
      let next: MediaState = "connecting";
      if (states.length === 0) next = "none";
      else if (states.some((s) => s.dtls === "failed" || s.ice === "disconnected" || s.dtls === "closed")) next = "disconnected";
      else if (states.every((s) => s.dtls === "connected")) next = "connected";
      if (next !== peer.media) {
        peer.media = next;
        this.schedulePresence();
      }
    };
    transport.on("icestatechange", refresh);
    transport.on("dtlsstatechange", refresh);
    transport.observer.on("close", () => {
      peer.transports.delete(transport.id);
      if (!this.closed) refresh();
    });
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async produce(peer: Peer, transportId: string, kind: "audio" | "video", rtpParameters: mt.RtpParameters, source: Source) {
    const transport = peer.transports.get(transportId);
    if (!transport || transport.appData.direction !== "send") throw new Error("bad-transport");
    // جایگزینی Producer قبلی همان منبع
    for (const p of [...peer.producers.values()]) if (p.appData.source === source) p.close();
    // تعیین حالت پیش از ساخت: اشتراک صفحه و تخته جایگزین یکدیگرند
    if (SOURCE_MODE[source]) {
      if (source === "screen-audio" && this.mode !== "screen") throw new Error("screen-not-active");
      if (source !== "screen-audio") this.setMode(SOURCE_MODE[source]!);
    }
    const producer = await transport.produce({ kind, rtpParameters, appData: { pid: peer.pid, source } });
    peer.producers.set(producer.id, producer);
    producer.observer.on("close", () => {
      peer.producers.delete(producer.id);
      if (this.closed) return;
      if ((source === "screen" || source === "board") && this.mode === SOURCE_MODE[source]) this.setMode("idle");
      this.schedulePresence();
    });
    this.schedulePresence();
    for (const other of this.peers.values()) {
      if (other.pid !== peer.pid) this.consume(other, producer).catch((e) => log.warn("consume failed", e.message));
    }
    return producer;
  }

  closeProducer(peer: Peer, producer: mt.Producer, notifyOwner = true): void {
    const source = producer.appData.source as Source;
    if (!producer.closed) producer.close();
    if (notifyOwner) this.send(peer, { t: "producerClosed", producerId: producer.id, source });
  }

  setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const teacher = this.teacher;
    if (teacher) {
      for (const p of [...teacher.producers.values()]) {
        const m = SOURCE_MODE[p.appData.source as Source];
        if (m && m !== mode) this.closeProducer(teacher, p);
      }
    }
    this.broadcast({ t: "mode", mode });
  }

  async consume(peer: Peer, producer: mt.Producer): Promise<void> {
    if (!peer.rtpCapabilities || producer.closed) return;
    if (producer.appData.pid === peer.pid) return;
    const transport = this.recvTransport(peer);
    if (!transport || transport.closed) return;
    if (!this.media.router.canConsume({ producerId: producer.id, rtpCapabilities: peer.rtpCapabilities })) return;
    const source = producer.appData.source as Source;
    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: peer.rtpCapabilities,
      paused: true,
      appData: { pid: producer.appData.pid, source },
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.observer.on("close", () => {
      peer.consumers.delete(consumer.id);
      this.send(peer, { t: "consumerClosed", consumerId: consumer.id, source });
    });
    this.send(peer, {
      t: "newConsumer",
      consumerId: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      source,
      from: producer.appData.pid,
    });
  }

  async consumeAll(peer: Peer): Promise<void> {
    for (const other of this.peers.values()) {
      if (other.pid === peer.pid) continue;
      for (const producer of other.producers.values()) {
        await this.consume(peer, producer).catch((e) => log.warn("consume failed", e.message));
      }
    }
  }

  // ───────────── اجازهٔ صحبت ─────────────
  grantSpeak(peer: Peer): void {
    if (peer.role !== "student") throw new Error("not-student");
    if (peer.canSpeak) return;
    if (this.speakers.length >= config.limits.maxSpeakers) throw new Error("max-speakers");
    peer.canSpeak = true;
    peer.hand = false;
    this.send(peer, { t: "speak", allowed: true });
    systemMessage(this, `${peer.name} اجازهٔ صحبت گرفت`);
    this.schedulePresence();
  }
  revokeSpeak(peer: Peer): void {
    if (!peer.canSpeak) return;
    peer.canSpeak = false;
    for (const p of [...peer.producers.values()]) if (p.appData.source === "mic") p.close();
    this.send(peer, { t: "speak", allowed: false });
    this.schedulePresence();
  }

  stateFor(peer: Peer) {
    return {
      id: this.id,
      title: this.title,
      mode: this.mode,
      chatEnabled: this.chatEnabled,
      chat: this.chatBuffer,
      presence: this.presenceFor(peer),
      question: questionViewFor(this, peer),
      boardInfo: this.boardInfo,
      maxSpeakers: config.limits.maxSpeakers,
    };
  }
}

export const newId = () => randomUUID();
