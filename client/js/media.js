// مدیریت رسانه با mediasoup-client: Device، Transportها، Producer و Consumer
const ms = () => window.mediasoupClient;

export class MediaClient {
  constructor(sig) {
    this.sig = sig;
    this.device = null;
    this.send = null;
    this.recv = null;
    this.producers = new Map(); // source -> Producer
    this.consumers = new Map(); // consumerId -> Consumer
    this.listeners = new Map();
    this.iceServers = [];
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  emit(type, data) {
    this.listeners.get(type)?.forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.error(e);
      }
    });
  }

  /** پس از ورود موفق: بارگذاری Device و ساخت Transport دریافت. */
  async init({ routerRtpCapabilities, iceServers }, { wantSend = false } = {}) {
    if (!ms()) throw new Error("کتابخانهٔ mediasoup-client بارگذاری نشد");
    this.iceServers = iceServers || [];
    this.device = new (ms().Device)();
    await this.device.load({ routerRtpCapabilities });
    // پیش از setRtpCaps باید شنونده‌ها آماده باشند، چون سرور بلافاصله Consumerها را می‌فرستد.
    this.sig.on("newConsumer", (m) => this.onNewConsumer(m).catch((e) => console.error("consume", e)));
    this.sig.on("consumerClosed", (m) => this.onConsumerClosed(m));
    this.sig.on("producerClosed", (m) => this.onProducerClosedByServer(m));
    this.recv = await this.createTransport("recv");
    await this.sig.request("setRtpCaps", { rtpCapabilities: this.device.rtpCapabilities });
    if (wantSend) await this.ensureSend();
  }

  async createTransport(direction) {
    const info = await this.sig.request("createTransport", { direction });
    const opts = { ...info, iceServers: this.iceServers };
    const t = direction === "send" ? this.device.createSendTransport(opts) : this.device.createRecvTransport(opts);
    t.on("connect", ({ dtlsParameters }, ok, fail) => {
      this.sig.request("connectTransport", { transportId: t.id, dtlsParameters }).then(ok).catch(fail);
    });
    if (direction === "send") {
      t.on("produce", ({ kind, rtpParameters, appData }, ok, fail) => {
        this.sig
          .request("produce", { transportId: t.id, kind, rtpParameters, source: appData.source })
          .then((r) => ok({ id: r.id }))
          .catch(fail);
      });
    }
    t.on("connectionstatechange", (state) => this.emit("state", { direction, state }));
    return t;
  }

  async ensureSend() {
    if (this.send && !this.send.closed) return this.send;
    this.send = await this.createTransport("send");
    return this.send;
  }

  async produce(source, track, opts = {}) {
    await this.ensureSend();
    const old = this.producers.get(source);
    if (old) {
      try {
        old.close();
      } catch {
        /* ignore */
      }
      this.producers.delete(source);
    }
    const producer = await this.send.produce({ track, stopTracks: false, appData: { source }, ...opts });
    this.producers.set(source, producer);
    producer.on("transportclose", () => {
      if (this.producers.get(source) === producer) this.producers.delete(source);
    });
    return producer;
  }

  /** بستن Producer یک منبع و اطلاع به سرور. */
  async closeSource(source) {
    const p = this.producers.get(source);
    if (!p) return;
    this.producers.delete(source);
    const id = p.id;
    try {
      p.close();
    } catch {
      /* ignore */
    }
    await this.sig.request("closeProducer", { producerId: id }).catch(() => {});
  }

  onProducerClosedByServer({ producerId, source }) {
    const p = this.producers.get(source);
    if (p && p.id === producerId) {
      try {
        p.close();
      } catch {
        /* ignore */
      }
      this.producers.delete(source);
    }
    this.emit("producer-closed", { source });
  }

  async onNewConsumer(m) {
    const consumer = await this.recv.consume({
      id: m.consumerId,
      producerId: m.producerId,
      kind: m.kind,
      rtpParameters: m.rtpParameters,
      appData: { source: m.source, from: m.from },
    });
    this.consumers.set(consumer.id, consumer);
    this.emit("track", { source: m.source, kind: m.kind, track: consumer.track, consumerId: consumer.id, from: m.from });
    await this.sig.request("resumeConsumer", { consumerId: consumer.id });
  }

  onConsumerClosed({ consumerId, source }) {
    const c = this.consumers.get(consumerId);
    if (!c) return;
    this.consumers.delete(consumerId);
    try {
      c.close();
    } catch {
      /* ignore */
    }
    this.emit("track-ended", { source, consumerId, from: c.appData?.from });
  }

  /** همهٔ منابع را آزاد می‌کند (هنگام قطع اتصال یا خروج). */
  close() {
    for (const p of this.producers.values()) {
      try {
        p.close();
      } catch {
        /* ignore */
      }
    }
    this.producers.clear();
    for (const c of this.consumers.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.consumers.clear();
    try {
      this.send?.close();
    } catch {
      /* ignore */
    }
    try {
      this.recv?.close();
    } catch {
      /* ignore */
    }
    this.send = this.recv = null;
  }
}
