import { $, $$, el, ico, hydrateIcons, setIcon, initRipples, initJoin, initTabs, setBadge, getClientId, toast, confirmDialog, showEnded, copyText, setPill, faNum, initials, beep } from "./common.js";
import { createSession } from "./signaling.js";
import { MediaClient } from "./media.js";
import { Whiteboard, PALETTE } from "./whiteboard.js";
import { ChatPanel } from "./chat.js";
import { TeacherQuestions } from "./questions.js";

hydrateIcons();
initRipples();

const S = {
  session: null,
  sig: null,
  media: null,
  pid: "",
  room: "",
  mode: "idle",
  micTrack: null,
  micOn: false,
  camTrack: null,
  boardTrack: null,
  screenStream: null,
  people: [],
  maxSpeakers: 3,
  tab: "people",
  ended: false,
};
const sig = () => S.sig;
const audioEls = new Map();

const board = new Whiteboard($("#boardCanvas"), $("#frame"), {
  onTool: (t) => {
    $$(".tool[data-tool]").forEach((b) => b.classList.toggle("is-on", b.dataset.tool === t));
    sendBoardInfo();
    paintStageLabel();
  },
  onColor: (c) => paintSwatches(c),
  onTheme: (t) => setIcon($("#btnTheme"), t === "dark" ? "sun" : "moon"),
  onDoc: () => {
    paintPager();
    paintStageLabel();
    sendBoardInfo();
  },
});

let infoTimer;
function sendBoardInfo() {
  clearTimeout(infoTimer);
  infoTimer = setTimeout(() => S.sig?.request("boardInfo", board.info()).catch(() => {}), 150);
}

// ───────────── پنل‌ها ─────────────
const chat = new ChatPanel($("#chatRoot"), {
  role: "teacher",
  getSig: sig,
  onUnread: (n) => setBadge($("#badgeChat"), S.tab === "chat" ? 0 : n),
});
const questions = new TeacherQuestions($("#qRoot"), sig, (n) => setBadge($("#badgeQ"), S.tab === "questions" ? 0 : n));
const selectTab = initTabs($("#panel"), (name) => {
  S.tab = name;
  chat.setActive(name === "chat");
  if (name === "chat") setBadge($("#badgeChat"), 0);
  if (name === "questions") setBadge($("#badgeQ"), 0);
});

// ───────────── ورود ─────────────
initJoin({
  role: "teacher",
  onSubmit: async (v) => {
    S.room = v.room;
    const info = { room: v.room, role: "teacher", name: v.name, title: v.title, key: v.key, clientId: getClientId() };
    S.session = createSession(info, {
      onJoined,
      onLost: () => {
        S.media?.close();
        S.media = null;
      },
      onStatus: (s) => setPill($("#connPill"), s === "online" ? "ok" : "warn", s === "online" ? "متصل" : "در حال اتصال مجدد…"),
      onFatal: (m) => {
        S.ended = true;
        showEnded("ارتباط قطع شد", m);
      },
    });
    await S.session.start();
  },
});

async function onJoined(res, s, isReconnect) {
  S.sig = s;
  S.pid = res.pid;
  const st = res.state;
  S.maxSpeakers = st.maxSpeakers;
  $("#join").hidden = true;
  $("#app").hidden = false;
  $("#classTitle").textContent = st.title;
  document.title = st.title + " · پنل استاد";
  $("#roomCode").textContent = S.room;
  chat.reset({ chat: st.chat, enabled: st.chatEnabled, myPid: res.pid });
  renderPeople(st.presence);
  questions.render(st.question);

  s.on("presence", renderPeople);
  s.on("chat", (m) => chat.add(m.message));
  s.on("chatEnabled", (m) => chat.setEnabled(m.enabled));
  s.on("question", (m) => questions.render(m.question));
  s.on("mode", (m) => paintMode(m.mode));
  s.on("handRaised", (m) => {
    toast(m.name + " دستش را بالا برد", "info");
    beep();
  });
  s.on("classEnded", () => {
    S.ended = true;
    cleanupLocal();
    showEnded("کلاس پایان یافت", "ارتباط همهٔ شرکت‌کنندگان بسته شد.");
  });

  const media = new MediaClient(s);
  S.media = media;
  media.on("track", onTrack);
  media.on("track-ended", onTrackEnded);
  media.on("producer-closed", ({ source }) => {
    if ((source === "screen" || source === "screen-audio") && S.screenStream) stopScreenLocal();
  });
  media.on("state", ({ state }) => {
    if (state === "failed" || state === "disconnected") setPill($("#connPill"), "warn", "اتصال رسانه ضعیف است");
    else if (state === "connected") setPill($("#connPill"), "ok", "متصل");
  });
  await media.init(res, { wantSend: true });

  if (isReconnect) await restoreMedia();
  else {
    await startBoard();
    await startMic();
  }
  window.onbeforeunload = () => (S.ended ? undefined : "کلاس در حال برگزاری است.");
}

// ───────────── دریافت صدای دانش‌آموزان مجاز ─────────────
function onTrack({ kind, track, consumerId }) {
  if (kind !== "audio") return;
  const a = el("audio", { autoplay: true });
  a.srcObject = new MediaStream([track]);
  $("#audioSink").append(a);
  a.play().catch(() => {});
  audioEls.set(consumerId, a);
}
function onTrackEnded({ consumerId }) {
  const a = audioEls.get(consumerId);
  if (a) {
    a.srcObject = null;
    a.remove();
    audioEls.delete(consumerId);
  }
}

// ───────────── حالت‌ها: تخته و اشتراک صفحه ─────────────
function paintMode(mode) {
  S.mode = mode;
  const board_ = mode === "board";
  const screen = mode === "screen";
  $$("#segMode button").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === mode));
  $("#boardCanvas").hidden = !board_;
  $("#screenPreview").hidden = !screen;
  $("#dock").hidden = !board_;
  $("#stageEmpty").hidden = mode !== "idle";
  $("#stage").classList.toggle("is-live", mode !== "idle");
  const pill = $("#livePill");
  pill.classList.toggle("live", mode !== "idle");
  $("#liveText").textContent = mode === "idle" ? "آماده" : "زنده";
  const share = $("#btnShare");
  share.classList.toggle("is-on", screen);
  share.querySelector(".lbl").textContent = screen ? "توقف اشتراک صفحه" : "اشتراک صفحه";
  $("#btnFile").disabled = !board_;
  paintPager();
  paintStageLabel();
}

function paintStageLabel() {
  const l = $("#stageLabel");
  const dot = l.querySelector(".dot");
  l.lastElementChild.textContent = "";
  let text = "";
  if (S.mode === "board") {
    const i = board.info();
    text = i.kind === "board" ? "تخته · " + toolName(i.tool) : i.fileName + (i.pages > 1 ? " · صفحهٔ " + faNum(i.page) + " از " + faNum(i.pages) : "");
  } else if (S.mode === "screen") text = "صفحهٔ شما برای کلاس نمایش داده می‌شود";
  else text = "هنوز چیزی نمایش داده نمی‌شود";
  l.lastElementChild.textContent = text;
  dot.className = "dot " + (S.mode === "idle" ? "" : "ok");
}
const toolName = (t) => ({ pen: "قلم", line: "خط", rect: "مستطیل", ellipse: "بیضی", arrow: "پیکان", text: "متن", eraser: "پاک‌کن" })[t] || t;

function paintPager() {
  const i = board.info();
  const show = S.mode === "board" && i.kind !== "board";
  $("#pager").hidden = !(show && i.pages > 1);
  $("#btnCloseDoc").hidden = !show;
  $("#pgText").textContent = faNum(i.page) + " از " + faNum(i.pages);
  $("#pgPrev").disabled = i.page <= 1;
  $("#pgNext").disabled = i.page >= i.pages;
}

async function startBoard() {
  try {
    stopScreenLocal();
    await sig().request("setMode", { mode: "board" });
    board.start();
    if (!S.boardTrack || S.boardTrack.readyState !== "live") {
      S.boardTrack = board.captureStream(25).getVideoTracks()[0];
      S.boardTrack.contentHint = "detail";
    }
    await S.media.produce("board", S.boardTrack, { encodings: [{ maxBitrate: 2_000_000 }] });
    paintMode("board");
    sendBoardInfo();
  } catch (e) {
    toast("شروع تخته ناموفق بود: " + e.message, "error");
  }
}

async function startScreen() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: true });
  } catch (e) {
    if (e.name !== "NotAllowedError") toast("اشتراک صفحه ممکن نشد: " + e.message, "error");
    return;
  }
  try {
    await sig().request("setMode", { mode: "screen" });
    board.stop();
    S.screenStream = stream;
    $("#screenPreview").srcObject = stream;
    const v = stream.getVideoTracks()[0];
    v.contentHint = "detail";
    v.addEventListener("ended", () => {
      if (S.screenStream === stream) stopScreen();
    });
    await S.media.produce("screen", v, { encodings: [{ maxBitrate: 2_500_000 }] });
    const a = stream.getAudioTracks()[0];
    if (a) await S.media.produce("screen-audio", a);
    else toast("صدای سیستم یا تب به اشتراک گذاشته نشد. در پنجرهٔ انتخاب، گزینهٔ «Share audio» را فعال کنید (فقط در برخی مرورگرها ممکن است). صدای میکروفون شما همچنان ارسال می‌شود.", "warn", 8000);
    paintMode("screen");
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    S.screenStream = null;
    toast("اشتراک صفحه ناموفق بود: " + e.message, "error");
    await startBoard();
  }
}

function stopScreenLocal() {
  const st = S.screenStream;
  S.screenStream = null;
  st?.getTracks().forEach((t) => t.stop());
  $("#screenPreview").srcObject = null;
}
async function stopScreen() {
  stopScreenLocal();
  await S.media?.closeSource("screen");
  await S.media?.closeSource("screen-audio");
  await startBoard();
}

// ───────────── میکروفون و دوربین ─────────────
const devErr = (e) => (e.name === "NotAllowedError" ? "اجازهٔ دسترسی به دستگاه داده نشد" : e.name === "NotFoundError" ? "دستگاهی پیدا نشد" : e.message);

async function startMic() {
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    S.micTrack = st.getAudioTracks()[0];
    await S.media.produce("mic", S.micTrack, { codecOptions: { opusDtx: true, opusFec: true } });
    S.micOn = true;
    sig().request("setMuted", { muted: false }).catch(() => {});
  } catch (e) {
    toast("میکروفون: " + devErr(e), "error");
  }
  paintControls();
}
async function toggleMic() {
  if (!S.micTrack || S.micTrack.readyState !== "live") return startMic();
  S.micOn = !S.micOn;
  S.micTrack.enabled = S.micOn;
  const p = S.media.producers.get("mic");
  if (S.micOn) p?.resume();
  else p?.pause();
  sig().request("setMuted", { muted: !S.micOn }).catch(() => {});
  paintControls();
}
async function toggleCam() {
  if (S.camTrack) {
    S.camTrack.stop();
    S.camTrack = null;
    $("#camPreview").srcObject = null;
    $("#camPip").hidden = true;
    await S.media.closeSource("camera");
  } else {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 } } });
      S.camTrack = st.getVideoTracks()[0];
      $("#camPreview").srcObject = st;
      $("#camPip").hidden = false;
      await S.media.produce("camera", S.camTrack, { encodings: [{ maxBitrate: 800_000 }] });
    } catch (e) {
      toast("دوربین: " + devErr(e), "error");
      S.camTrack?.stop();
      S.camTrack = null;
      $("#camPip").hidden = true;
    }
  }
  paintControls();
}
function paintControls() {
  const mic = $("#btnMic");
  const has = S.micTrack && S.micTrack.readyState === "live";
  mic.classList.toggle("is-off", !has || !S.micOn);
  mic.classList.toggle("is-on", has && S.micOn);
  setIcon(mic, has && S.micOn ? "mic" : "mic-off");
  mic.querySelector(".lbl").textContent = !has ? "روشن‌کردن میکروفون" : S.micOn ? "میکروفون روشن" : "میکروفون بی‌صدا";
  const cam = $("#btnCam");
  cam.classList.toggle("is-on", Boolean(S.camTrack));
  setIcon(cam, S.camTrack ? "video" : "video-off");
  cam.querySelector(".lbl").textContent = S.camTrack ? "دوربین روشن" : "دوربین";
}

/** پس از اتصال مجدد، رسانه‌های محلی دوباره به سرور ارسال می‌شوند. */
async function restoreMedia() {
  try {
    if (S.micTrack?.readyState === "live") {
      const p = await S.media.produce("mic", S.micTrack, { codecOptions: { opusDtx: true, opusFec: true } });
      if (!S.micOn) p.pause();
      sig().request("setMuted", { muted: !S.micOn }).catch(() => {});
    }
    if (S.camTrack?.readyState === "live") await S.media.produce("camera", S.camTrack, { encodings: [{ maxBitrate: 800_000 }] });
    const v = S.screenStream?.getVideoTracks()[0];
    if (v && v.readyState === "live") {
      await sig().request("setMode", { mode: "screen" });
      await S.media.produce("screen", v, { encodings: [{ maxBitrate: 2_500_000 }] });
      const a = S.screenStream.getAudioTracks()[0];
      if (a) await S.media.produce("screen-audio", a);
      paintMode("screen");
    } else await startBoard();
  } catch (e) {
    toast("بازیابی رسانه ناموفق بود: " + e.message, "error");
  }
  paintControls();
}

function cleanupLocal() {
  window.onbeforeunload = null;
  board.stop();
  stopScreenLocal();
  S.micTrack?.stop();
  S.camTrack?.stop();
  S.boardTrack?.stop();
  S.media?.close();
}

// ───────────── فهرست دانش‌آموزان ─────────────
function renderPeople(p) {
  S.people = p.list;
  const students = p.list.filter((x) => x.role === "student");
  $("#countText").textContent = faNum(students.length);
  chat.setNames(new Map(p.list.map((x) => [x.pid, x.name])));
  const hands = students.filter((x) => x.hand).sort((a, b) => a.handAt - b.handAt);
  setBadge($("#badgeP" + "eople"), hands.length);
  const speakers = students.filter((x) => x.canSpeak);
  const live = students.filter((x) => x.micLive && !x.muted);
  const pill = $("#peerAudioPill");
  pill.hidden = !live.length;
  $("#peerAudioText").textContent = faNum(live.length) + " نفر صحبت می‌کنند";

  const root = $("#peopleList");
  root.textContent = "";
  if (!students.length) {
    root.append(el("div", { class: "empty" }, ico("users"), "هنوز دانش‌آموزی وارد نشده است.", el("span", { class: "hint" }, "پیوند ورود را با دکمهٔ «پیوند دانش‌آموز» بالای صفحه کپی کنید.")));
    return;
  }
  if (hands.length) {
    root.append(el("div", { class: "section-title" }, ico("hand"), "دست‌های بلند", el("span", { class: "badge amber", text: faNum(hands.length) })));
    hands.forEach((s) => root.append(person(s, true)));
    root.append(el("div", { style: { height: "14px" } }));
  }
  root.append(el("div", { class: "section-title" }, ico("mic"), "مجوز صحبت: " + faNum(speakers.length) + " از " + faNum(S.maxSpeakers)));
  root.append(el("div", { class: "section-title", style: { marginTop: "6px" } }, ico("users"), "در کلاس", el("span", { class: "badge", text: faNum(students.length) })));
  students.filter((s) => !s.hand).forEach((s) => root.append(person(s, false)));
}

function person(s, isHand) {
  const act = async (t, data) => {
    try {
      await sig().request(t, data);
    } catch (e) {
      toast(e.message, "error");
    }
  };
  const mediaDot = { connected: "ok", connecting: "warn", disconnected: "bad", none: "" }[s.media] || "";
  const sub = el("div", { class: "sub" });
  if (s.micLive && !s.muted) sub.append(el("span", { class: "live" }, ico("mic"), "در حال صحبت"));
  else if (s.canSpeak) sub.append(el("span", { class: "live" }, ico("mic"), "مجاز به صحبت"));
  else if (isHand) sub.append(el("span", { text: "درخواست صحبت دارد" }));
  else sub.append(el("span", { text: s.media === "connected" ? "رسانه وصل است" : s.media === "disconnected" ? "رسانه قطع است" : "آنلاین" }));
  const acts = el("div", { class: "acts" });
  if (isHand) {
    acts.append(
      el("button", { class: "btn sm primary icon-btn", title: "تأیید و اجازهٔ صحبت", onclick: () => act("handResolve", { pid: s.pid, action: "approve" }) }, ico("check")),
      el("button", { class: "btn sm icon-btn", title: "رد درخواست", onclick: () => act("handResolve", { pid: s.pid, action: "reject" }) }, ico("x")),
    );
  } else {
    acts.append(
      el("button", { class: "btn sm icon-btn" + (s.canSpeak ? " is-on" : ""), title: s.canSpeak ? "لغو مجوز صحبت" : "اجازهٔ صحبت", onclick: () => act("setSpeak", { pid: s.pid, allowed: !s.canSpeak }) }, ico(s.canSpeak ? "mic" : "mic-off")),
    );
  }
  acts.append(el("button", { class: "btn sm ghost icon-btn", title: "پیام خصوصی", onclick: () => (selectTab("chat"), chat.focusPrivate(s.pid, s.name)) }, ico("lock")));
  return el("div", { class: "person" + (isHand ? " hand" : "") }, el("div", { class: "avatar" }, initials(s.name), el("span", { class: "dot " + mediaDot })), el("div", { class: "meta" }, el("div", { class: "name", text: s.name }), sub), acts);
}

// ───────────── ابزارهای تخته ─────────────
const sw = $("#swatches");
function paintSwatches(color) {
  sw.querySelectorAll(".swatch").forEach((b) => b.classList.toggle("is-on", b.dataset.c.toLowerCase() === color.toLowerCase()));
}
PALETTE.forEach((c) => sw.append(el("button", { class: "swatch", "data-c": c, title: "رنگ قلم", style: { background: c }, onclick: () => (board.setColor(c), paintSwatches(c)) })));
paintSwatches(board.color);

$$(".tool[data-tool]").forEach((b) => b.addEventListener("click", () => board.setTool(b.dataset.tool)));
const range = $("#sizeRange");
const dot = $("#sizeDot");
const paintSize = () => {
  const s = Number(range.value);
  board.setSize(s);
  const d = Math.max(3, Math.min(22, s * 1.2 + 2));
  dot.style.width = dot.style.height = d + "px";
};
range.addEventListener("input", paintSize);
paintSize();
$("#btnUndo").addEventListener("click", () => board.undo());
$("#btnClear").addEventListener("click", async () => {
  if (await confirmDialog({ title: "پاک‌کردن کامل تخته؟", text: "همهٔ نوشته‌ها و نقاشی‌های این صفحه پاک می‌شوند.", confirmText: "پاک کن", danger: true })) board.clear();
});
$("#btnTheme").addEventListener("click", () => board.setTheme(board.theme === "dark" ? "light" : "dark"));
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    board.undo();
  }
});

// ───────────── کنترل‌ها ─────────────
$("#btnMic").addEventListener("click", toggleMic);
$("#btnCam").addEventListener("click", toggleCam);
$("#btnShare").addEventListener("click", () => (S.mode === "screen" ? stopScreen() : startScreen()));

// تمام‌صفحه کردن تخته / صحنه
$("#btnFull").addEventListener("click", () => {
  const el = $("#stageView");
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    el.requestFullscreen?.().catch(() => toast("تمام‌صفحه در این مرورگر ممکن نیست", "warn"));
  }
});

// تغییر آیکون وقتی وارد/خارج تمام‌صفحه می‌شویم
document.addEventListener("fullscreenchange", () => {
  const btn = $("#btnFull");
  if (!btn) return;
  const isFull = Boolean(document.fullscreenElement);
  setIcon(btn, isFull ? "x" : "maximize");
  btn.title = isFull ? "خروج از تمام‌صفحه" : "تمام‌صفحه";
});


$$("#segMode button").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.mode === "board") S.mode === "screen" ? stopScreen() : S.mode !== "board" && startBoard();
    else if (S.mode !== "screen") startScreen();
  }),
);
$("#btnFile").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    if (S.mode !== "board") await startBoard();
    await board.loadFile(f);
  } catch (err) {
    toast(err.message || "فایل باز نشد", "error");
  }
});
// تمام‌صفحه دوربین استاد
$("#btnCamFull")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const pip = $("#camPip");
  if (!pip) return;
  if (document.fullscreenElement === pip) {
    document.exitFullscreen();
  } else {
    pip.requestFullscreen?.().catch(() => toast("تمام‌صفحه در این مرورگر ممکن نیست", "warn"));
  }
});
$("#pgNext").addEventListener("click", () => board.goto(board.doc.page + 1));
$("#pgPrev").addEventListener("click", () => board.goto(board.doc.page - 1));
$("#btnCloseDoc").addEventListener("click", () => board.closeDoc());
$("#btnCopy").addEventListener("click", async () => {
  const url = `${location.origin}/student.html?room=${encodeURIComponent(S.room)}`;
  toast((await copyText(url)) ? "پیوند ورود دانش‌آموز کپی شد" : "کپی انجام نشد: " + url, "success");
});
$("#btnEnd").addEventListener("click", async () => {
  if (await confirmDialog({ title: "کلاس را پایان بدهیم؟", text: "ارتباط همهٔ دانش‌آموزان قطع می‌شود و اطلاعات موقت کلاس پاک می‌شود.", confirmText: "پایان کلاس", danger: true })) {
    S.ended = true;
    sig().request("endClass").catch(() => {});
  }
});
window.addEventListener("pagehide", () => S.session?.stop());

paintControls();
paintMode("idle");
