// تختهٔ مجازی روی Canvas: قلم، شکل‌ها، متن، پاک‌کن، تصویر و PDF.
// خروجی canvas با captureStream به mediasoup داده می‌شود؛ دانش‌آموزان فقط ویدئو را می‌بینند.

export const W = 1600;
export const H = 900;
export const PALETTE = ["#ffffff", "#38c8e8", "#45dba2", "#ffb84d", "#ff6b84", "#b794f6", "#10203a"];
const THEMES = {
  dark: { bg: "#0d192e", dot: "rgba(255,255,255,0.075)", ink: "#ffffff" },
  light: { bg: "#f6f8fc", dot: "rgba(16,32,58,0.11)", ink: "#10203a" },
};
const RTL_RE = /[\u0590-\u08FF]/;
const TEXT_BOX = 360;

function layer() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return c;
}

export class Whiteboard {
  constructor(canvas, host, hooks = {}) {
    this.canvas = canvas;
    this.host = host;
    this.hooks = hooks;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.bg = layer();
    this.bctx = this.bg.getContext("2d");
    this.layer = layer();
    this.lctx = this.layer.getContext("2d");
    this.theme = "dark";
    this.tool = "pen";
    this.color = THEMES.dark.ink;
    this.size = 4;
    this.doc = { id: "board", kind: "board", fileName: "", page: 1, pages: 1 };
    this.pdf = null;
    this.image = null;
    this.store = new Map();
    this.live = null;
    this.timer = null;
    this.textBox = null;
    this.renderTask = null;
    this.renderSeq = 0;
    this.bindPointer();
    this.paintBackground();
    this.render();
  }

  // ───────────── چرخهٔ نمایش ─────────────
  /** تا وقتی فعال است، canvas هر ۴۰ میلی‌ثانیه بازنقاشی می‌شود تا جریان ویدئویی هرگز متوقف نشود. */
  start() {
    if (!this.timer) this.timer = setInterval(() => this.render(), 40);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
  render() {
    const c = this.ctx;
    c.drawImage(this.bg, 0, 0);
    c.drawImage(this.layer, 0, 0);
    if (this.live && this.live.type !== "erase") this.drawOp(c, this.live);
  }
  captureStream(fps = 25) {
    return this.canvas.captureStream(fps);
  }

  // ───────────── وضعیت و ابزارها ─────────────
  get key() {
    return `${this.doc.id}:${this.doc.page}`;
  }
  get ops() {
    if (!this.store.has(this.key)) this.store.set(this.key, []);
    return this.store.get(this.key);
  }
  info() {
    return { kind: this.doc.kind, fileName: this.doc.fileName, page: this.doc.page, pages: this.doc.pages, tool: this.tool };
  }
  setTool(t) {
    this.commitText();
    this.tool = t;
    this.canvas.style.cursor = t === "text" ? "text" : "crosshair";
    this.hooks.onTool?.(t);
  }
  setColor(c) {
    this.color = c;
  }
  setSize(s) {
    this.size = s;
  }
  setTheme(name) {
    const prev = THEMES[this.theme].ink;
    this.theme = name;
    if (this.color === prev) {
      this.color = THEMES[name].ink;
      this.hooks.onColor?.(this.color);
    }
    this.paintBackground();
    if (this.pdf) this.refreshPage();
    this.hooks.onTheme?.(name);
  }

  undo() {
    this.commitText();
    this.ops.pop();
    this.redrawLayer();
    this.hooks.onChange?.();
  }
  /** همهٔ نوشته‌ها و نقاشی‌های صفحهٔ فعلی پاک می‌شود. */
  clear() {
    this.cancelText();
    this.store.set(this.key, []);
    this.redrawLayer();
    this.hooks.onChange?.();
  }
  redrawLayer() {
    this.lctx.clearRect(0, 0, W, H);
    for (const op of this.ops) this.drawOp(this.lctx, op);
  }

  // ───────────── رسم ─────────────
  drawOp(c, op) {
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = op.color || "#fff";
    c.fillStyle = op.color || "#fff";
    c.lineWidth = op.w || 4;
    switch (op.type) {
      case "pen":
      case "erase": {
        if (op.type === "erase") c.globalCompositeOperation = "destination-out";
        const p = op.pts;
        c.beginPath();
        if (p.length === 1) {
          c.arc(p[0].x, p[0].y, c.lineWidth / 2, 0, Math.PI * 2);
          c.fill();
        } else {
          c.moveTo(p[0].x, p[0].y);
          for (let i = 1; i < p.length - 1; i++) {
            const mx = (p[i].x + p[i + 1].x) / 2;
            const my = (p[i].y + p[i + 1].y) / 2;
            c.quadraticCurveTo(p[i].x, p[i].y, mx, my);
          }
          c.lineTo(p[p.length - 1].x, p[p.length - 1].y);
          c.stroke();
        }
        break;
      }
      case "line":
        c.beginPath();
        c.moveTo(op.x0, op.y0);
        c.lineTo(op.x1, op.y1);
        c.stroke();
        break;
      case "arrow": {
        const a = Math.atan2(op.y1 - op.y0, op.x1 - op.x0);
        const h = Math.max(16, op.w * 4.5);
        c.beginPath();
        c.moveTo(op.x0, op.y0);
        c.lineTo(op.x1, op.y1);
        c.moveTo(op.x1 - h * Math.cos(a - 0.45), op.y1 - h * Math.sin(a - 0.45));
        c.lineTo(op.x1, op.y1);
        c.lineTo(op.x1 - h * Math.cos(a + 0.45), op.y1 - h * Math.sin(a + 0.45));
        c.stroke();
        break;
      }
      case "rect":
        c.strokeRect(Math.min(op.x0, op.x1), Math.min(op.y0, op.y1), Math.abs(op.x1 - op.x0), Math.abs(op.y1 - op.y0));
        break;
      case "ellipse":
        c.beginPath();
        c.ellipse((op.x0 + op.x1) / 2, (op.y0 + op.y1) / 2, Math.abs(op.x1 - op.x0) / 2, Math.abs(op.y1 - op.y0) / 2, 0, 0, Math.PI * 2);
        c.stroke();
        break;
      case "text": {
        c.font = `500 ${op.size}px Vazirmatn, Tahoma, sans-serif`;
        c.textBaseline = "top";
        const rtl = RTL_RE.test(op.text);
        c.direction = rtl ? "rtl" : "ltr";
        c.textAlign = rtl ? "right" : "left";
        const x = rtl ? op.x + TEXT_BOX : op.x;
        op.text.split("\n").forEach((line, i) => c.fillText(line, x, op.y + i * op.size * 1.5));
        break;
      }
    }
    c.restore();
  }

  paintBackground() {
    const t = THEMES[this.theme];
    const c = this.bctx;
    c.fillStyle = t.bg;
    c.fillRect(0, 0, W, H);
    if (this.doc.kind === "board") {
      c.fillStyle = t.dot;
      for (let x = 50; x < W; x += 50) for (let y = 50; y < H; y += 50) c.fillRect(x - 1, y - 1, 2.4, 2.4);
    }
    if (this.image) {
      const m = 24;
      const k = Math.min((W - 2 * m) / this.image.width, (H - 2 * m) / this.image.height);
      const w = this.image.width * k;
      const h = this.image.height * k;
      c.drawImage(this.image, (W - w) / 2, (H - h) / 2, w, h);
    }
  }

  pt(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }

  bindPointer() {
    const cv = this.canvas;
    cv.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      this.commitText();
      const p = this.pt(e);
      if (this.tool === "text") return this.openText(p);
      cv.setPointerCapture(e.pointerId);
      const w = this.tool === "eraser" ? this.size * 5 : this.size * 1.4;
      if (this.tool === "pen") this.live = { type: "pen", color: this.color, w, pts: [p] };
      else if (this.tool === "eraser") {
        this.live = { type: "erase", w, pts: [p] };
        this.drawOp(this.lctx, this.live);
      } else this.live = { type: this.tool, color: this.color, w, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    });
    cv.addEventListener("pointermove", (e) => {
      if (!this.live) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const p = this.pt(ev);
        if (this.live.pts) {
          const last = this.live.pts[this.live.pts.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2) continue;
          this.live.pts.push(p);
          if (this.live.type === "erase") this.drawOp(this.lctx, { ...this.live, pts: [last, p] });
        } else {
          this.live.x1 = p.x;
          this.live.y1 = p.y;
        }
      }
    });
    const end = () => {
      if (!this.live) return;
      const op = this.live;
      this.live = null;
      if (op.type !== "erase") this.drawOp(this.lctx, op);
      this.ops.push(op);
      this.hooks.onChange?.();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
  }

  // ───────────── ابزار متن ─────────────
  openText(p) {
    const r = this.canvas.getBoundingClientRect();
    const hr = this.host.getBoundingClientRect();
    const k = r.width / W;
    const fontPx = 24 + this.size * 2;
    const ta = document.createElement("textarea");
    ta.className = "text-overlay";
    ta.setAttribute("wrap", "off");
    ta.setAttribute("dir", "auto");
    ta.rows = 1;
    ta.style.left = r.left - hr.left + p.x * k + "px";
    ta.style.top = r.top - hr.top + p.y * k + "px";
    ta.style.width = TEXT_BOX * k + "px";
    ta.style.fontSize = fontPx * k + "px";
    ta.style.color = this.color;
    ta.style.fontWeight = 500;
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.cancelText();
      else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.commitText();
      } else {
        requestAnimationFrame(() => {
          ta.rows = ta.value.split("\n").length;
        });
      }
    });
    ta.addEventListener("blur", () => this.commitText());
    this.host.append(ta);
    this.textBox = { ta, x: p.x, y: p.y, size: fontPx, color: this.color };
    setTimeout(() => ta.focus(), 0);
  }
  commitText() {
    const tb = this.textBox;
    if (!tb) return;
    this.textBox = null;
    const text = tb.ta.value.replace(/\s+$/g, "");
    tb.ta.remove();
    if (!text) return;
    const op = { type: "text", x: tb.x, y: tb.y, text, color: tb.color, size: tb.size };
    this.drawOp(this.lctx, op);
    this.ops.push(op);
    this.hooks.onChange?.();
  }
  cancelText() {
    if (!this.textBox) return;
    this.textBox.ta.remove();
    this.textBox = null;
  }

  // ───────────── فایل‌ها: تصویر و PDF ─────────────
  async loadFile(file) {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return this.loadPdf(file);
    if (file.type.startsWith("image/")) {
      const bmp = await createImageBitmap(file);
      return this.setDoc({ kind: "image", fileName: file.name, pages: 1, image: bmp });
    }
    throw new Error("فقط تصویر یا فایل PDF پشتیبانی می‌شود");
  }
  async loadPdf(file) {
    const pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    return this.setDoc({ kind: "pdf", fileName: file.name, pages: pdf.numPages, pdf });
  }
  async setDoc(d) {
    this.cancelText();
    const id = "d" + Date.now();
    // نقاشی‌های فایل قبلی از حافظه پاک می‌شود
    for (const k of [...this.store.keys()]) if (!k.startsWith("board:")) this.store.delete(k);
    this.doc = { id, kind: d.kind, fileName: d.fileName, page: 1, pages: d.pages };
    this.pdf = d.pdf || null;
    this.image = d.image || null;
    await this.refreshPage();
  }
  closeDoc() {
    this.cancelText();
    for (const k of [...this.store.keys()]) if (!k.startsWith("board:")) this.store.delete(k);
    try {
      this.pdf?.destroy?.();
    } catch {
      /* ignore */
    }
    this.pdf = null;
    this.image = null;
    this.doc = { id: "board", kind: "board", fileName: "", page: 1, pages: 1 };
    return this.refreshPage();
  }
  async goto(n) {
    const page = Math.min(Math.max(1, n), this.doc.pages);
    if (page === this.doc.page) return;
    this.cancelText();
    this.doc.page = page;
    await this.refreshPage();
  }
  async refreshPage() {
    const seq = ++this.renderSeq;
    this.paintBackground();
    this.redrawLayer();
    if (this.pdf) {
      try {
        this.renderTask?.cancel();
        const page = await this.pdf.getPage(this.doc.page);
        if (seq !== this.renderSeq) return;
        const v0 = page.getViewport({ scale: 1 });
        const s = Math.min((W - 40) / v0.width, (H - 40) / v0.height);
        const vp = page.getViewport({ scale: s });
        const tmp = document.createElement("canvas");
        tmp.width = Math.ceil(vp.width);
        tmp.height = Math.ceil(vp.height);
        this.renderTask = page.render({ canvasContext: tmp.getContext("2d"), viewport: vp, canvas: tmp });
        await this.renderTask.promise;
        if (seq !== this.renderSeq) return;
        this.bctx.drawImage(tmp, (W - tmp.width) / 2, (H - tmp.height) / 2);
      } catch (e) {
        if (e?.name !== "RenderingCancelledException") console.error("pdf render", e);
      }
    }
    this.hooks.onDoc?.(this.info());
  }
}
