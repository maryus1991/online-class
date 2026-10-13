// ابزارهای مشترک صفحه‌های استاد و دانش‌آموز

const S = (d) => d;
export const ICONS = {
  live: S('<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>'),
  mic: S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  "mic-off": S('<path d="M3 3l18 18"/><path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11.2 5.6M19 11a7 7 0 0 1-.6 2.8M12 18v3"/>'),
  video: S('<rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3z"/>'),
  "video-off": S('<path d="M3 3l18 18"/><path d="M10 6h3a3 3 0 0 1 3 3v3M16 15a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 1.5-2.6"/><path d="M16 10l5-3v10l-3.5-2"/>'),
  screen: S('<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20h8M12 16v4"/><path d="M9 11l3-3 3 3M12 8v6"/>'),
  board: S('<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8 20l4-4 4 4M7 10c2-2.4 3 2.4 5 0s3 1.6 5-.8"/>'),
  pen: S('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>'),
  line: S('<path d="M5 19L19 5"/>'),
  rect: S('<rect x="4" y="6" width="16" height="12" rx="2"/>'),
  ellipse: S('<ellipse cx="12" cy="12" rx="8.5" ry="6"/>'),
  arrow: S('<path d="M5 19L19 5M10 5h9v9"/>'),
  text: S('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  eraser: S('<path d="M7 20h12M5.5 15.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H8l-2.5-2.5a1.4 1.4 0 0 1 0-1z"/>'),
  undo: S('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  trash: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  file: S('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 17v-6M9.5 13.5L12 11l2.5 2.5"/>'),
  "chevron-left": S('<path d="M15 5l-7 7 7 7"/>'),
  "chevron-right": S('<path d="M9 5l7 7-7 7"/>'),
  hand: S('<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3 14.5a1.5 1.5 0 0 1 2.5-1.6L8 16V12"/>'),
  send: S('<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>'),
  chat: S('<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>'),
  help: S('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 17h.01"/>'),
  users: S('<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.2a5 5 0 0 1 4 4.8"/>'),
  lock: S('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  image: S('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>'),
  copy: S('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  maximize: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  volume: S('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>'),
  "volume-off": S('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  power: S('<path d="M12 3v8M7 6.5a8 8 0 1 0 10 0"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  moon: S('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  alert: S('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
};

const SVG_NS = "http://www.w3.org/2000/svg";
export function ico(name, cls = "") {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", ("i " + cls).trim());
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || "";
  return s;
}
/** هر <i data-i="نام"> را با آیکون SVG جایگزین می‌کند. */
export function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-i]").forEach((n) => n.replaceWith(ico(n.dataset.i, n.className)));
}
/** آیکون یک دکمه را عوض می‌کند. */
export function setIcon(btn, name) {
  const old = btn.querySelector("svg.i");
  const fresh = ico(name, old?.getAttribute("class")?.replace(/^i\s?/, "") || "");
  if (old) old.replaceWith(fresh);
  else btn.prepend(fresh);
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export const faNum = (n) => Number(n).toLocaleString("fa-IR");
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
export const initials = (name) => (name || "؟").trim().slice(0, 1).toUpperCase();
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function qs() {
  return new URLSearchParams(location.search);
}

/** شناسهٔ خصوصی مرورگر؛ برای هر تب جدا نگه داشته می‌شود (sessionStorage) تا قطع و وصل شدن همان کاربر را به‌جا بیاورد. */
export function getClientId() {
  let id = sessionStorage.getItem("clientId");
  if (!id) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    id = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem("clientId", id);
  }
  return id;
}

export function toast(msg, type = "info", ms = 3800) {
  const host = $("#toasts");
  if (!host) return;
  const icoName = { error: "alert", success: "check", warn: "alert", info: "info" }[type] || "info";
  const t = el("div", { class: "toast " + type, role: "status" }, ico(icoName), el("span", { text: msg }));
  host.append(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 320);
  }, ms);
}

export function confirmDialog({ title, text, confirmText = "تأیید", cancelText = "انصراف", danger = false }) {
  return new Promise((resolve) => {
    const done = (v) => {
      overlay.remove();
      resolve(v);
    };
    const overlay = el(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true", onclick: (e) => e.target === overlay && done(false) },
      el(
        "div",
        { class: "modal-card" },
        el("h3", { text: title }),
        text ? el("p", { text }) : null,
        el(
          "div",
          { class: "row end" },
          el("button", { class: "btn", text: cancelText, onclick: () => done(false) }),
          el("button", { class: "btn " + (danger ? "danger" : "primary"), text: confirmText, onclick: () => done(true) }),
        ),
      ),
    );
    document.body.append(overlay);
    overlay.querySelector(".btn.primary, .btn.danger")?.focus();
  });
}

export function lightbox(src) {
  const o = el("div", { class: "modal lightbox", onclick: () => o.remove() }, el("img", { src, alt: "" }));
  document.body.append(o);
}

export function showEnded(title, text, withReload = true) {
  const box = el(
    "div",
    { class: "ended", role: "alertdialog" },
    ico("power"),
    el("h2", { text: title }),
    el("p", { text }),
    withReload ? el("button", { class: "btn primary", text: "بازگشت به صفحهٔ ورود", onclick: () => (location.href = location.pathname + location.search) }) : null,
  );
  document.body.append(box);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el("textarea", { style: { position: "fixed", opacity: "0" } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** وضعیت یک pill (ok / warn / bad / ""). */
export function setPill(pill, state, text) {
  pill.classList.remove("ok", "warn", "bad");
  if (state) pill.classList.add(state);
  const t = pill.querySelector("span:not(.dot)");
  if (t && text != null) t.textContent = text;
}

/** تصویر را کوچک می‌کند و به DataURL فشرده تبدیل می‌کند (برای سؤال تصویری). */
export async function downscaleImage(file, maxDim = 1000, quality = 0.8) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

let audioCtx;
export function beep() {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.4);
  } catch {
    /* بدون صدا */
  }
}

/** موج کوچکی که هنگام کلیک روی دکمه‌ها پخش می‌شود. */
export function initRipples() {
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest?.(".btn, .tool, .tab");
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2;
    const s = el("span", { class: "ripple", style: { width: d + "px", height: d + "px", left: e.clientX - r.left - d / 2 + "px", top: e.clientY - r.top - d / 2 + "px" } });
    if (getComputedStyle(b).position === "static") b.style.position = "relative";
    b.style.overflow = "hidden";
    b.append(s);
    setTimeout(() => s.remove(), 600);
  });
}

export function initTabs(panel, onChange) {
  const tabs = $$(".tab", panel);
  const select = (name) => {
    tabs.forEach((t) => t.classList.toggle("is-on", t.dataset.tab === name));
    $$(".pane", panel).forEach((p) => p.classList.toggle("is-on", p.id === "pane-" + name));
    onChange?.(name);
  };
  tabs.forEach((t) => t.addEventListener("click", () => select(t.dataset.tab)));
  return select;
}

export function setBadge(node, n) {
  if (!node) return;
  node.hidden = !n;
  node.textContent = typeof n === "number" ? faNum(n) : n || "";
}

/** فرم ورود: مقداردهی اولیه، نمایش خطا و جلوگیری از ارسال دوباره. */
export function initJoin({ role, onSubmit }) {
  const form = $("#joinForm");
  const err = $("#joinError");
  const btn = $("#joinBtn");
  const room = $("#fRoom");
  const name = $("#fName");
  const p = qs();
  if (p.get("room")) room.value = p.get("room");
  else if (role === "teacher") room.value = "class-" + Math.random().toString(36).slice(2, 6);
  name.value = localStorage.getItem("displayName:" + role) || "";
  const showErr = (m) => {
    err.textContent = m;
    err.classList.toggle("show", Boolean(m));
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showErr("");
    btn.disabled = true;
    const label = btn.lastChild.textContent;
    btn.lastChild.textContent = "در حال ورود…";
    try {
      localStorage.setItem("displayName:" + role, name.value.trim());
      await onSubmit({ room: room.value.trim(), name: name.value.trim(), title: $("#fTitle")?.value.trim(), key: $("#fKey")?.value });
    } catch (ex) {
      showErr(ex.message || "ورود ناموفق بود");
      btn.disabled = false;
      btn.lastChild.textContent = label;
    }
  });
  return { showErr };
}
