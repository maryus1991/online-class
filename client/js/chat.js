// پنل چت: عمومی + خصوصی (دانش‌آموز ↔ استاد). نمایش فقط با textContent انجام می‌شود.
import { el, ico, faNum, fmtTime, toast, setIcon } from "./common.js";

export class ChatPanel {
  constructor(root, { role, getSig, onUnread }) {
    this.root = root;
    this.role = role;
    this.getSig = getSig;
    this.onUnread = onUnread || (() => {});
    this.mode = "public";
    this.unread = { public: 0, private: 0 };
    this.active = false;
    this.enabled = true;
    this.myPid = "";
    this.names = new Map();
    this.replyTo = null;
    this.build();
  }

  build() {
    const r = this.root;
    r.textContent = "";
    this.btnPub = el("button", { class: "is-on", onclick: () => this.setMode("public") }, "عمومی");
    this.btnPriv = el("button", { onclick: () => this.setMode("private") }, ico("lock"), this.role === "teacher" ? "خصوصی" : "پیام به استاد");
    this.dotPub = el("span", { class: "badge", hidden: true });
    this.dotPriv = el("span", { class: "badge amber", hidden: true });
    this.btnPub.append(this.dotPub);
    this.btnPriv.append(this.dotPriv);
    const top = el("div", { class: "chat-top" }, el("div", { class: "seg" }, this.btnPub, this.btnPriv));
    if (this.role === "teacher") {
      this.toggle = el("button", { class: "btn sm is-on", onclick: () => this.toggleChat() }, ico("chat"), el("span", { text: "چت عمومی فعال" }));
      top.append(this.toggle);
    }
    this.pubList = el("div", { class: "chat-list" });
    this.privList = el("div", { class: "chat-list", hidden: true });
    this.reply = el("div", { class: "reply-chip", hidden: true });
    this.note = el("div", { class: "composer-note", hidden: true, text: "چت عمومی توسط استاد غیرفعال شده است. می‌توانید به استاد پیام خصوصی بدهید." });
    this.input = el("input", { class: "input", maxlength: "500", placeholder: "پیام خود را بنویسید…", autocomplete: "off" });
    this.send = el("button", { class: "btn primary icon-btn", title: "ارسال", style: { width: "44px", height: "44px" }, onclick: () => this.submit() }, ico("send"));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        this.submit();
      }
    });
    this.composer = el("div", { class: "composer" }, this.input, this.send);
    r.append(top, this.pubList, this.privList, this.note, this.reply, this.composer);
    this.refreshComposer();
  }

  setMode(m) {
    this.mode = m;
    this.btnPub.classList.toggle("is-on", m === "public");
    this.btnPriv.classList.toggle("is-on", m === "private");
    this.pubList.hidden = m !== "public";
    this.privList.hidden = m !== "private";
    this.unread[m] = 0;
    this.refreshComposer();
    this.paintBadges();
    this.scroll();
  }
  setActive(a) {
    this.active = a;
    if (a) {
      this.unread[this.mode] = 0;
      this.paintBadges();
      this.scroll();
    }
  }
  paintBadges() {
    for (const [dot, n] of [[this.dotPub, this.unread.public], [this.dotPriv, this.unread.private]]) {
      dot.hidden = !n;
      dot.textContent = faNum(n);
    }
    this.onUnread(this.unread.public + this.unread.private);
  }

  refreshComposer() {
    const pub = this.mode === "public";
    const blocked = pub && this.role === "student" && !this.enabled;
    this.input.disabled = blocked;
    this.send.disabled = blocked;
    this.input.placeholder = blocked ? "چت عمومی غیرفعال است" : pub ? "پیام برای همهٔ کلاس…" : this.role === "teacher" ? "پاسخ خصوصی…" : "پیام خصوصی به استاد…";
    this.note.hidden = !blocked;
    this.reply.hidden = !(this.role === "teacher" && !pub && this.replyTo);
    if (this.role === "teacher" && !pub) {
      this.reply.textContent = "";
      if (this.replyTo) {
        this.reply.append(ico("lock"), el("span", { text: "پاسخ خصوصی به " + this.replyTo.name }), el("button", { title: "لغو", onclick: () => this.setReply(null) }, ico("x")));
      }
    }
  }

  setReply(target) {
    this.replyTo = target;
    this.refreshComposer();
  }
  /** استاد از فهرست حاضران برای دانش‌آموز پیام خصوصی می‌نویسد. */
  focusPrivate(pid, name) {
    this.setMode("private");
    this.setReply({ pid, name });
    this.input.focus();
  }

  setNames(map) {
    this.names = map;
  }
  setEnabled(b) {
    this.enabled = b;
    if (this.toggle) {
      this.toggle.classList.toggle("is-on", b);
      this.toggle.classList.toggle("is-off", !b);
      this.toggle.lastChild.textContent = b ? "چت عمومی فعال" : "چت عمومی خاموش";
    }
    this.refreshComposer();
  }
  async toggleChat() {
    try {
      await this.getSig().request("setChat", { enabled: !this.enabled });
    } catch (e) {
      toast(e.message, "error");
    }
  }

  reset({ chat, enabled, myPid }) {
    this.myPid = myPid;
    this.pubList.textContent = "";
    this.privList.textContent = "";
    this.unread = { public: 0, private: 0 };
    this.setEnabled(enabled);
    (chat || []).forEach((m) => this.add(m, true));
    this.paintBadges();
    this.scroll(true);
  }

  add(m, silent = false) {
    const priv = m.kind === "private";
    const list = priv ? this.privList : this.pubList;
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.append(this.node(m));
    while (list.children.length > 300) list.firstChild.remove();
    const mine = m.from?.pid === this.myPid;
    const key = priv ? "private" : "public";
    if (!silent && m.kind !== "system" && !mine && !(this.active && this.mode === key)) {
      this.unread[key]++;
      this.paintBadges();
    }
    if (near || mine) this.scroll();
  }

  node(m) {
    if (m.kind === "system") return el("div", { class: "sys", text: m.text });
    const mine = m.from.pid === this.myPid;
    const t = m.from.role === "teacher";
    let who = m.from.name;
    if (m.kind === "private" && this.role === "teacher") who = mine ? "شما ← " + (this.names.get(m.to) || "دانش‌آموز") : m.from.name;
    const n = el(
      "div",
      { class: ["msg", mine ? "mine" : "", t ? "teacher" : "", m.kind === "private" ? "private" : ""].join(" ").trim() },
      el("div", { class: "who" }, el("span", { text: who }), t ? el("span", { class: "tag", text: "استاد" }) : null),
      el("div", { class: "txt", text: m.text }),
      el("span", { class: "time num", text: fmtTime(m.at) }),
    );
    if (m.kind === "private" && this.role === "teacher" && !mine) {
      n.style.cursor = "pointer";
      n.title = "برای پاسخ کلیک کنید";
      n.addEventListener("click", () => {
        this.setReply({ pid: m.from.pid, name: m.from.name });
        this.input.focus();
      });
    }
    return n;
  }

  scroll(force) {
    const l = this.mode === "public" ? this.pubList : this.privList;
    requestAnimationFrame(() => (l.scrollTop = l.scrollHeight));
  }

  async submit() {
    const text = this.input.value.trim();
    if (!text) return;
    const sig = this.getSig();
    try {
      if (this.mode === "public") await sig.request("chat", { text });
      else {
        if (this.role === "teacher" && !this.replyTo) return toast("ابتدا یک پیام خصوصی را انتخاب کنید یا از فهرست دانش‌آموزان گیرنده را برگزینید", "warn");
        await sig.request("privateChat", { text, to: this.replyTo?.pid });
      }
      this.input.value = "";
    } catch (e) {
      toast(e.message, "error");
    }
  }
}
