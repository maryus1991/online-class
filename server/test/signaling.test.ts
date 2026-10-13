import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// آزمون یکپارچهٔ سیگنالینگ: سرور واقعی (با mediasoup) اجرا می‌شود و با WebSocket به آن وصل می‌شویم.
// انتقال واقعی رسانه (RTP) در این آزمون بررسی نمی‌شود؛ آن را باید با مرورگر آزمایش کرد.
const PORT = 3911;
const KEY = "test-key-123";
let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), TEACHER_KEY: KEY, MEDIASOUP_WORKERS: "1", RTC_PORT_MIN: "41000", MAX_SPEAKERS: "1", HEARTBEAT_TIMEOUT_SEC: "30" },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error("server did not start");
});
afterAll(() => proc.kill());

class Client {
  ws!: WebSocket;
  events: any[] = [];
  pending = new Map<number, (m: any) => void>();
  seq = 1;
  pid = "";
  cid = "cid" + Math.random().toString(36).slice(2, 12) + "abcdef";
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.t === "res") this.pending.get(m.id)?.(m);
      else this.events.push(m);
    };
    await new Promise<void>((r) => (this.ws.onopen = () => r()));
    return this;
  }
  req(t: string, data: any = {}): Promise<any> {
    const id = this.seq++;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ t, id, ...data }));
    });
  }
  async join(role: string, name: string, room = "room1", key?: string, clientId?: string) {
    const r = await this.req("join", { room, role, name, key, clientId: clientId ?? this.cid, title: "ریاضی" });
    if (r.ok) this.pid = r.data.pid;
    return r;
  }
  ev(t: string) {
    return this.events.filter((e) => e.t === t);
  }
}
const wait = (ms = 400) => Bun.sleep(ms);

describe("signaling", () => {
  let teacher: Client, s1: Client, s2: Client;

  test("دانش‌آموز قبل از شروع کلاس نمی‌تواند وارد شود", async () => {
    const c = await new Client().open();
    const r = await c.join("student", "علی");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("room-not-found");
  });

  test("استاد با کلید غلط وارد نمی‌شود، با کلید درست کلاس ساخته می‌شود", async () => {
    const bad = await new Client().open();
    expect((await bad.join("teacher", "استاد", "room1", "wrong")).error).toBe("forbidden");
    teacher = await new Client().open();
    const r = await teacher.join("teacher", "استاد", "room1", KEY);
    expect(r.ok).toBe(true);
    expect(r.data.routerRtpCapabilities.codecs.length).toBeGreaterThan(0);
    expect(r.data.state.title).toBe("ریاضی");
  });

  test("چند دانش‌آموز وارد می‌شوند و فهرست حضور برای استاد به‌روز می‌شود", async () => {
    s1 = await new Client().open();
    s2 = await new Client().open();
    expect((await s1.join("student", "سارا")).ok).toBe(true);
    expect((await s2.join("student", "رضا")).ok).toBe(true);
    await wait();
    const pres = teacher.ev("presence").at(-1);
    expect(pres.students).toBe(2);
    expect(pres.list.length).toBe(3);
  });

  test("دانش‌آموز با ادعای نقش استاد و بدون کلید رد می‌شود و کارهای استاد را نمی‌تواند انجام دهد", async () => {
    expect((await s1.req("qCreate", { question: { kind: "text", text: "؟" } })).error).toBe("forbidden");
    expect((await s1.req("setChat", { enabled: false })).error).toBe("forbidden");
    expect((await s1.req("setSpeak", { pid: s2.pid, allowed: true })).error).toBe("forbidden");
    expect((await s1.req("setMode", { mode: "board" })).error).toBe("forbidden");
    const fake = await new Client().open();
    expect((await fake.join("teacher", "جعلی", "room1", "")).error).toBe("forbidden");
  });

  test("چت عمومی و خصوصی: پیام خصوصی فقط به مقصد می‌رسد", async () => {
    await s1.req("chat", { text: "سلام" });
    await s1.req("privateChat", { text: "راز" });
    await wait();
    const pub = (c: Client) => c.ev("chat").filter((e) => e.message.text === "سلام");
    expect(pub(teacher).length).toBe(1);
    expect(pub(s2).length).toBe(1);
    const priv = (c: Client) => c.ev("chat").filter((e) => e.message.text === "راز");
    expect(priv(teacher).length).toBe(1);
    expect(priv(s1).length).toBe(1);
    expect(priv(s2).length).toBe(0);
    // دانش‌آموز نمی‌تواند به دانش‌آموز دیگر خصوصی بفرستد (مقصد همیشه استاد است)
    await s1.req("privateChat", { text: "به رضا", to: s2.pid });
    await wait(200);
    expect(s2.ev("chat").filter((e) => e.message.text === "به رضا").length).toBe(0);
  });

  test("غیرفعال‌کردن چت عمومی", async () => {
    expect((await teacher.req("setChat", { enabled: false })).ok).toBe(true);
    expect((await s1.req("chat", { text: "x" })).error).toBe("chat-disabled");
    expect((await teacher.req("chat", { text: "اعلام استاد" })).ok).toBe(true);
    await teacher.req("setChat", { enabled: true });
  });

  test("پرسش و پاسخ: یک پاسخ برای هر دانش‌آموز و نمایش به ورودی دیرهنگام", async () => {
    const q = await teacher.req("qCreate", { question: { kind: "choice", text: "۲+۲؟", options: ["۳", "۴", "۵"] } });
    expect(q.ok).toBe(true);
    await wait();
    const qid = s1.ev("question").at(-1).question.id;
    expect((await s1.req("qAnswer", { questionId: qid, answer: 1 })).ok).toBe(true);
    expect((await s1.req("qAnswer", { questionId: qid, answer: 2 })).error).toBe("already-answered");
    expect((await s2.req("qAnswer", { questionId: qid, answer: 99 })).error).toBe("bad-answer");
    await wait(500);
    const tq = teacher.ev("question").at(-1).question;
    expect(tq.answered).toBe(1);
    expect(tq.pending).toBe(1);
    // دانش‌آموز نتیجهٔ دیگران را نمی‌بیند
    const sq = s2.ev("question").at(-1).question;
    expect(sq.answers).toBeUndefined();
    expect(sq.results).toBeUndefined();
    // ورود دیرهنگام
    const late = await new Client().open();
    const r = await late.join("student", "دیرآمده");
    expect(r.data.state.question.id).toBe(qid);
    expect(r.data.state.question.answered).toBe(false);
    // قطع و وصل شدن با همان شناسه، حق پاسخ مجدد نمی‌دهد
    const keepCid = s1.cid;
    s1.ws.close();
    await wait(300);
    s1 = await new Client().open();
    s1.cid = keepCid;
    const rj = await s1.join("student", "سارا");
    expect(rj.data.state.question.answered).toBe(true);
    expect((await s1.req("qAnswer", { questionId: qid, answer: 0 })).error).toBe("already-answered");
    // بستن سؤال
    await teacher.req("qClose");
    expect((await s2.req("qAnswer", { questionId: qid, answer: 0 })).error).toBe("closed");
    late.ws.close();
  });

  test("اجازهٔ صحبت در سرور کنترل می‌شود", async () => {
    // بدون مجوز نمی‌تواند Transport ارسال بسازد
    expect((await s2.req("createTransport", { direction: "send" })).error).toBe("forbidden");
    expect((await s2.req("produce", { transportId: "x", kind: "audio", rtpParameters: {}, source: "mic" })).error).toBe("forbidden");
    expect((await s2.req("produce", { transportId: "x", kind: "video", rtpParameters: {}, source: "camera" })).error).toBe("forbidden");
    // دست بلند کردن
    await s2.req("raiseHand", { raised: true });
    await wait(300);
    const t = teacher.ev("presence").at(-1);
    expect(t.list.find((p: any) => p.pid === s2.pid).hand).toBe(true);
    expect(s1.ev("presence").at(-1).list.every((p: any) => p.hand === undefined)).toBe(true);
    // تأیید → مجاز
    expect((await teacher.req("handResolve", { pid: s2.pid, action: "approve" })).ok).toBe(true);
    const tr = await s2.req("createTransport", { direction: "send" });
    expect(tr.ok).toBe(true);
    expect(tr.data.iceCandidates.length).toBeGreaterThan(0);
    // حداکثر گویندگان (MAX_SPEAKERS=1)
    expect((await teacher.req("setSpeak", { pid: s1.pid, allowed: true })).error).toBe("max-speakers");
    // لغو مجوز
    expect((await teacher.req("setSpeak", { pid: s2.pid, allowed: false })).ok).toBe(true);
    await wait(200);
    expect(s2.ev("speak").at(-1).allowed).toBe(false);
    expect((await s2.req("produce", { transportId: tr.data.id, kind: "audio", rtpParameters: {}, source: "mic" })).error).toBe("forbidden");
  });

  test("خروج دانش‌آموز او را از فهرست حذف می‌کند و پایان کلاس همه را می‌بندد", async () => {
    s2.ws.close();
    await wait(400);
    expect(teacher.ev("presence").at(-1).students).toBe(1);
    const closed = new Promise<void>((r) => (s1.ws.onclose = () => r()));
    await teacher.req("endClass");
    await closed;
    expect(s1.ev("classEnded").length).toBe(1);
    const h = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json();
    expect(h.rooms).toBe(0);
  });
});
