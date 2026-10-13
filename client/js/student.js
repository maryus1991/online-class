import { $, $$, el, ico, hydrateIcons, setIcon, initRipples, initJoin, initTabs, setBadge, getClientId, toast, confirmDialog, showEnded, setPill, faNum, initials, beep } from "./common.js";
import { createSession } from "./signaling.js";
import { MediaClient } from "./media.js";
import { ChatPanel } from "./chat.js";
import { StudentQuestions } from "./questions.js";

hydrateIcons();
initRipples();

const S = {
  session: null,
  sig: null,
  media: null,
  pid: "",
  name: "",
  mode: "idle",
  canSpeak: false,
  hand: false,
  micTrack: null,
  micOn: false,
  volMuted: false,
  mainConsumer: null,
  teacherOnline: true,
  tab: "chat",
  ended: false,
};
const sig = () => S.sig;
const audioEls = new Map();
const video = $("#mainVideo");

const chat = new ChatPanel($("#chatRoot"), {
  role: "student",
  getSig: sig,
  onUnread: (n) => setBadge($("#badgeChat"), S.tab === "chat" ? 0 : n),
});
const questions = new StudentQuestions($("#qRoot"), sig, {
  onNew: () => {
    toast("استاد یک سؤال فرستاد", "info", 5000);
    beep();
    if (S.tab !== "question") setBadge($("#badgeQ"), "!");
  },
});
const selectTab = initTabs($("#panel"), (name) => {
  S.tab = name;
  chat.setActive(name === "chat");
  if (name === "chat") setBadge($("#badgeChat"), 0);
  if (name === "question") setBadge($("#badgeQ"), 0);
});

// ───────────── ورود ─────────────
initJoin({
  role: "student",
  onSubmit: async (v) => {
    S.name = v.name;
    const info = { room: v.room, role: "student", name: v.name, clientId: getClientId() };
    S.session = createSession(info, {
      onJoined,
      onLost: () => {
        S.media?.close();
        S.media = null;
        resetMedia();
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

async function onJoined(res, s) {
  S.sig = s;
  S.pid = res.pid;
  const st = res.state;
  $("#join").hidden = true;
  $("#app").hidden = false;
  $("#classTitle").textContent = st.title;
  $("#whoAmI").textContent = "شما: " + res.name;
  document.title = st.title + " · کلاس زنده";
  // پس از هر ورود، مجوز و دست بلند در سرور از نو شروع می‌شود
  S.canSpeak = false;
  S.hand = false;
  stopMic(false);
  paintHand();
  paintMic();
  chat.reset({ chat: st.chat, enabled: st.chatEnabled, myPid: res.pid });
  questions.render(st.question);
  renderPeople(st.presence);
  paintMode(st.mode);
  paintBoardInfo(st.boardInfo);

  s.on("presence", renderPeople);
  s.on("chat", (m) => chat.add(m.message));
  s.on("chatEnabled", (m) => chat.setEnabled(m.enabled));
  s.on("question", (m) => questions.render(m.question));
  s.on("mode", (m) => paintMode(m.mode));
  s.on("boardInfo", (m) => paintBoardInfo(m.info));
  s.on("teacherStatus", (m) => setTeacherOnline(m.online));
  s.on("speak", (m) => onSpeak(m.allowed));
  s.on("handRejected", () => {
    S.hand = false;
    paintHand();
    toast("درخواست شما پذیرفته نشد", "warn");
  });
  s.on("classEnded", () => {
    S.ended = true;
    cleanup();
    showEnded("کلاس پایان یافت", "استاد کلاس را به پایان رساند.");
  });

  const media = new MediaClient(s);
  S.media = media;
  media.on("track", onTrack);
  media.on("track-ended", onTrackEnded);
  media.on("producer-closed", ({ source }) => {
    if (source === "mic") stopMic(false);
  });
  media.on("state", ({ state }) => {
    if (state === "failed" || state === "disconnected") setPill($("#connPill"), "warn", "اتصال رسانه ضعیف است");
    else if (state === "connected") setPill($("#connPill"), "ok", "متصل");
  });
  await media.init(res);
}

// ───────────── دریافت رسانه ─────────────
let muteTimer;
function onTrack({ source, kind, track, consumerId }) {
  if (kind === "audio") {
    const a = el("audio", { autoplay: true });
    a.srcObject = new MediaStream([track]);
    a.muted = S.volMuted;
    $("#audioSink").append(a);
    a.play().catch(() => toast("برای شنیدن صدا یک‌بار روی صفحه کلیک کنید", "warn"));
    audioEls.set(consumerId, a);
    return;
  }
  if (source === "camera") {
    $("#camVideo").srcObject = new MediaStream([track]);
    $("#camVideo").play().catch(() => {});
    $("#camPip").hidden = false;
    return;
  }
  // board یا screen
  S.mainConsumer = consumerId;
  video.srcObject = new MediaStream([track]);
  video.play().catch(() => {});
  $("#stageEmpty").hidden = true;
  const msg = $("#stageMsg");
  const show = (t) => {
    $("#stageMsgText").textContent = t;
    msg.hidden = false;
  };
  if (track.muted) show("در حال دریافت تصویر…");
  track.addEventListener("unmute", () => {
    clearTimeout(muteTimer);
    msg.hidden = true;
  });
  track.addEventListener("mute", () => {
    clearTimeout(muteTimer);
    muteTimer = setTimeout(() => show("تصویر استاد در حال حاضر دریافت نمی‌شود"), 1500);
  });
}
function onTrackEnded({ source, consumerId }) {
  const a = audioEls.get(consumerId);
  if (a) {
    a.srcObject = null;
    a.remove();
    audioEls.delete(consumerId);
    return;
  }
  if (source === "camera") {
    $("#camVideo").srcObject = null;
    $("#camPip").hidden = true;
  } else if (consumerId === S.mainConsumer) {
    S.mainConsumer = null;
    video.srcObject = null;
    $("#stageMsg").hidden = true;
    paintMode(S.mode);
  }
}
function resetMedia() {
  for (const a of audioEls.values()) {
    a.srcObject = null;
    a.remove();
  }
  audioEls.clear();
  video.srcObject = null;
  S.mainConsumer = null;
  $("#camVideo").srcObject = null;
  $("#camPip").hidden = true;
  $("#stageMsg").hidden = true;
  stopMic(false);
  paintMode(S.mode);
}

// ───────────── نمایش وضعیت ─────────────
const MODE_TEXT = { idle: "منتظر شروع ارائهٔ استاد", board: "تختهٔ استاد", screen: "اشتراک صفحهٔ استاد" };
function paintMode(mode) {
  S.mode = mode;
  const live = mode !== "idle";
  $("#stage").classList.toggle("is-live", live && S.teacherOnline);
  $("#livePill").classList.toggle("live", live);
  $("#liveText").textContent = live ? "زنده" : "منتظر استاد";
  const l = $("#stageLabel");
  l.lastElementChild.textContent = MODE_TEXT[mode];
  l.querySelector(".dot").className = "dot " + (live ? "ok" : "");
  $("#boardChip").hidden = mode !== "board" || !$("#boardChipText").textContent;
  if (!S.mainConsumer) {
    $("#stageEmpty").hidden = false;
    $("#emptyTitle").textContent = live ? "در حال دریافت تصویر" : "منتظر استاد";
    $("#emptyText").textContent = live ? "چند لحظه صبر کنید…" : "به‌محض اینکه استاد تخته یا صفحه‌اش را نمایش بدهد، همین‌جا می‌بینید.";
  }
}
function paintBoardInfo(i) {
  const names = { pen: "قلم", line: "خط", rect: "مستطیل", ellipse: "بیضی", arrow: "پیکان", text: "متن", eraser: "پاک‌کن" };
  const t = i.kind === "board" ? "تخته · " + (names[i.tool] || "") : i.fileName + (i.pages > 1 ? " · صفحهٔ " + faNum(i.page) + " از " + faNum(i.pages) : "");
  $("#boardChipText").textContent = t;
  $("#boardChip").hidden = S.mode !== "board";
}
function setTeacherOnline(on) {
  S.teacherOnline = on;
  let w = $("#sWait");
  if (!on && !w) $("#stageView").append(el("div", { class: "s-wait", id: "sWait" }, ico("alert"), "استاد در حال حاضر متصل نیست؛ تا بازگشت او منتظر بمانید."));
  if (on && w) w.remove();
  paintMode(S.mode);
}
function renderPeople(p) {
  $("#countText").textContent = faNum(p.students);
  setTeacherOnline(p.teacherOnline);
  const root = $("#peopleList");
  root.textContent = "";
  const sorted = [...p.list].sort((a, b) => (a.role === "teacher" ? -1 : b.role === "teacher" ? 1 : a.name.localeCompare(b.name, "fa")));
  root.append(el("div", { class: "section-title" }, ico("users"), "حاضران", el("span", { class: "badge", text: faNum(p.list.length) })));
  sorted.forEach((x) =>
    root.append(
      el(
        "div",
        { class: "person" },
        el("div", { class: "avatar" + (x.role === "teacher" ? " t" : "") }, initials(x.name)),
        el("div", { class: "meta" }, el("div", { class: "name", text: x.name + (x.pid === S.pid ? " (شما)" : "") }), el("div", { class: "sub" }, x.role === "teacher" ? "استاد" : x.speaking ? el("span", { class: "live" }, ico("mic"), "اجازهٔ صحبت دارد") : "دانش‌آموز")),
      ),
    ),
  );
}

// ───────────── دست بلند کردن و میکروفون ─────────────
function paintHand() {
  const b = $("#btnHand");
  b.classList.toggle("is-warn", S.hand);
  b.disabled = S.canSpeak;
  $("#handText").textContent = S.canSpeak ? "اجازهٔ صحبت دارید" : S.hand ? "دست شما بالاست · لغو" : "دست بلند کردن";
}
function paintMic() {
  const st = $("#micState");
  const has = S.micTrack && S.micTrack.readyState === "live";
  st.className = "mic-state" + (S.canSpeak ? (has && S.micOn ? " live" : " allowed") : "");
  setIcon(st, S.canSpeak && has && S.micOn ? "mic" : "mic-off");
  $("#micText").textContent = !S.canSpeak ? "میکروفون شما بسته است" : has && S.micOn ? "میکروفون شما روشن است" : has ? "میکروفون بی‌صدا شد" : "اجازهٔ صحبت دارید";
  const b = $("#btnMic");
  b.hidden = !S.canSpeak;
  $("#btnMicText").textContent = !has ? "روشن‌کردن میکروفون" : S.micOn ? "بی‌صدا کردن" : "برداشتن بی‌صدایی";
  setIcon(b, has && S.micOn ? "mic-off" : "mic");
}
async function onSpeak(allowed) {
  S.canSpeak = allowed;
  S.hand = false;
  paintHand();
  if (allowed) {
    toast("استاد به شما اجازهٔ صحبت داد 🎤", "success");
    beep();
    await startMic();
  } else {
    toast("مجوز صحبت شما لغو شد", "warn");
    stopMic(false);
  }
  paintMic();
}
async function startMic() {
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    S.micTrack = st.getAudioTracks()[0];
    await S.media.produce("mic", S.micTrack, { codecOptions: { opusDtx: true, opusFec: true } });
    S.micOn = true;
    sig().request("setMuted", { muted: false }).catch(() => {});
  } catch (e) {
    S.micTrack?.stop();
    S.micTrack = null;
    toast(e.name === "NotAllowedError" ? "اجازهٔ میکروفون در مرورگر داده نشد" : "میکروفون روشن نشد: " + e.message, "error");
  }
  paintMic();
}
function stopMic(notify) {
  S.micTrack?.stop();
  S.micTrack = null;
  S.micOn = false;
  if (notify) S.media?.closeSource("mic");
  paintMic();
}
$("#btnMic").addEventListener("click", async () => {
  if (!S.micTrack || S.micTrack.readyState !== "live") return startMic();
  S.micOn = !S.micOn;
  S.micTrack.enabled = S.micOn;
  const p = S.media.producers.get("mic");
  if (S.micOn) p?.resume();
  else p?.pause();
  sig().request("setMuted", { muted: !S.micOn }).catch(() => {});
  paintMic();
});
$("#btnHand").addEventListener("click", async () => {
  const next = !S.hand;
  try {
    await sig().request("raiseHand", { raised: next });
    S.hand = next;
    paintHand();
    if (next) toast("درخواست شما برای استاد ارسال شد", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

// ───────────── صدا، تمام‌صفحه، خروج ─────────────
$("#btnVol").addEventListener("click", () => {
  S.volMuted = !S.volMuted;
  audioEls.forEach((a) => (a.muted = S.volMuted));
  setIcon($("#btnVol"), S.volMuted ? "volume-off" : "volume");
  toast(S.volMuted ? "صدای کلاس قطع شد" : "صدای کلاس وصل شد", "info", 1800);
});
$("#btnFull").addEventListener("click", () => {
  const t = $("#stageView");
  if (document.fullscreenElement) document.exitFullscreen();
  else t.requestFullscreen?.().catch(() => toast("تمام‌صفحه در این مرورگر ممکن نیست", "warn"));
});
$("#btnLeave").addEventListener("click", async () => {
  if (await confirmDialog({ title: "از کلاس خارج می‌شوید؟", confirmText: "خروج", danger: true })) {
    S.ended = true;
    cleanup();
    S.session?.stop();
    location.href = location.pathname + location.search;
  }
});
function cleanup() {
  resetMedia();
  S.media?.close();
}
window.addEventListener("pagehide", () => S.session?.stop());
paintHand();
paintMic();
