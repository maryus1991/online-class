// ارتباط WebSocket با سرور (سیگنالینگ + پیام‌های کنترلی) و اتصال مجدد خودکار

export class Signaling {
  constructor() {
    this.ws = null;
    this.seq = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.pingTimer = null;
    this.closedByUs = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  emit(type, data) {
    this.handlers.get(type)?.forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.error("handler error", type, e);
      }
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.pingTimer = setInterval(() => this.request("ping").catch(() => {}), 10000);
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new Error("اتصال به سرور برقرار نشد"));
      };
      ws.onclose = (e) => {
        clearInterval(this.pingTimer);
        for (const p of this.pending.values()) p.reject(new Error("اتصال قطع شد"));
        this.pending.clear();
        if (!opened) return reject(new Error("اتصال به سرور برقرار نشد"));
        this.emit("close", { code: e.code, reason: e.reason, clean: this.closedByUs });
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.t === "res") {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          clearTimeout(p.timer);
          if (m.ok) p.resolve(m.data);
          else p.reject(Object.assign(new Error(m.message || m.error), { code: m.error }));
        } else {
          this.emit(m.t, m);
        }
      };
    });
  }

  request(t, data = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error("اتصال برقرار نیست"));
      const id = this.seq++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("پاسخی از سرور نیامد"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ t, id, ...data }));
    });
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.pingTimer);
    try {
      this.ws?.close(1000, "bye");
    } catch {
      /* ignore */
    }
  }
}

const FATAL = new Set(["room-not-found", "forbidden", "teacher-exists", "bad-room", "bad-name", "bad-client", "room-full", "server-full"]);

/**
 * جلسهٔ کلاس: ورود، اتصال مجدد با تأخیر فزاینده و گزارش وضعیت به صفحه.
 * handlers.onJoined(data, sig, isReconnect)  ← پس از هر ورود موفق (برای ساخت رسانه)
 * handlers.onLost()                           ← هنگام قطع ناگهانی (برای رها کردن منابع رسانه)
 * handlers.onStatus('online'|'reconnecting')
 * handlers.onFatal(message)                   ← خطای غیرقابل‌تکرار (مثلاً پایان کلاس)
 */
export function createSession(info, handlers) {
  let sig = null;
  let stopped = false;
  let ended = false;

  async function connect(isReconnect) {
    const s = new Signaling();
    sig = s;
    s.on("close", (ev) => onClose(s, ev));
    s.on("classEnded", () => {
      ended = true;
    });
    s.on("replaced", () => {
      ended = true;
      handlers.onFatal("این کلاس در تب یا دستگاه دیگری باز شد و اتصال این صفحه بسته شد.");
    });
    await s.connect();
    const data = await s.request("join", info);
    await handlers.onJoined(data, s, isReconnect);
    handlers.onStatus("online");
    return data;
  }

  async function onClose(s, ev) {
    if (s !== sig || stopped || ev.clean || ended) return;
    handlers.onStatus("reconnecting");
    handlers.onLost?.();
    const delays = [1000, 2000, 3000, 5000, 8000, 8000, 10000, 10000];
    for (const d of delays) {
      await new Promise((r) => setTimeout(r, d));
      if (stopped || ended) return;
      try {
        await connect(true);
        return;
      } catch (e) {
        if (FATAL.has(e.code)) return handlers.onFatal(e.message);
      }
    }
    handlers.onFatal("ارتباط با سرور برقرار نشد. صفحه را دوباره باز کنید.");
  }

  return {
    start: () => connect(false),
    stop() {
      stopped = true;
      sig?.close();
    },
    get sig() {
      return sig;
    },
  };
}
