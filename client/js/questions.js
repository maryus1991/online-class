// پرسش و پاسخ زنده: بخش استاد (ساخت و پایش) و بخش دانش‌آموز (پاسخ)
import { el, ico, faNum, toast, downscaleImage, lightbox } from "./common.js";

const KIND_LABEL = { text: "پاسخ متنی", choice: "چندگزینه‌ای" };

function bars(q, counts, total) {
  return el(
    "div",
    { class: "opts" },
    q.options.map((o, i) => {
      const c = counts?.[i] ?? 0;
      return el(
        "div",
        { class: "opt" },
        el("i", { class: "bar", style: { width: (total ? (c / total) * 100 : 0) + "%" } }),
        el("span", { text: o }),
        el("span", { class: "cnt num", text: faNum(c) }),
      );
    }),
  );
}

export class TeacherQuestions {
  constructor(root, getSig, onBadge) {
    this.root = root;
    this.getSig = getSig;
    this.onBadge = onBadge || (() => {});
    this.q = null;
    this.showBuilder = true;
    this.draft = { kind: "choice", text: "", options: ["", "", "", ""], image: null };
    this.render(null);
  }

  render(q) {
    const prevId = this.q?.id;
    this.q = q;
    if (q && q.id !== prevId) this.showBuilder = false;
    if (!q) this.showBuilder = true;
    this.onBadge(q && q.open ? q.pending : 0);

    // فقط وقتی کاربر واقعاً در حال تایپ داخل فیلد است رندر کامل را متوقف کن
    // (نه وقتی روی دکمهٔ افزودن/حذف گزینه یا تغییر نوع سؤال کلیک کرده)
    const ae = document.activeElement;
    const isTyping =
      this.showBuilder &&
      q?.id === prevId &&
      ae &&
      this.root.contains(ae) &&
      ae.closest(".qbuilder") &&
      (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT") &&
      ae.type !== "file" &&
      ae.type !== "button" &&
      ae.type !== "submit";

    if (isTyping) {
      this.updateStats();
      return;
    }

    this.root.textContent = "";
    const stack = el("div", { class: "stack" });
    if (q) stack.append(this.activeCard(q));
    if (this.showBuilder) stack.append(this.builder());
    else
      stack.append(
        el("button", { class: "btn block", onclick: () => ((this.showBuilder = true), this.render(this.q)) }, ico("plus"), "سؤال جدید"),
      );
    this.root.append(stack);
  }

  updateStats() {
    /* فقط وقتی فرم باز است و کاربر تایپ می‌کند؛ کارت فعال در رندر بعدی تازه می‌شود */
  }

  async call(t, data) {
    try {
      await this.getSig().request(t, data);
    } catch (e) {
      toast(e.message, "error");
    }
  }

  activeCard(q) {
    const total = q.online || 0;
    const done = q.answered || 0;
    const card = el("div", { class: "qcard" + (q.open ? " open" : "") });

    card.append(
      el(
        "div",
        { class: "row", style: { justifyContent: "space-between" } },
        el(
          "span",
          { class: "qstate" + (q.open ? "" : " closed") },
          el("span", { class: "dot " + (q.open ? "ok" : "") }),
          q.open ? "سؤال فعال است" : "سؤال بسته شد",
        ),
        el("span", { class: "hint", text: KIND_LABEL[q.kind] }),
      ),
      el("div", { class: "qtext", text: q.text }),
    );

    if (q.image) {
      card.append(el("img", { class: "qimg", src: q.image, alt: "تصویر سؤال", onclick: () => lightbox(q.image) }));
    }

    card.append(
      el(
        "div",
        { class: "statrow" },
        el("div", { class: "stat ok" }, el("b", { class: "num", text: faNum(done) }), el("span", { text: "پاسخ داده‌اند" })),
        el("div", { class: "stat wait" }, el("b", { class: "num", text: faNum(q.pending) }), el("span", { text: "هنوز پاسخ نداده‌اند" })),
        el("div", { class: "stat" }, el("b", { class: "num", text: faNum(total) }), el("span", { text: "حاضر در کلاس" })),
      ),
      el("div", { class: "progress" }, el("i", { style: { width: (total ? (done / total) * 100 : 0) + "%" } })),
    );

    // نمودار برای چندگزینه‌ای
    if (q.kind === "choice") {
      card.append(bars(q, q.counts, q.answers?.length || 0));
    }

    // لیست پاسخ‌دهندگان (هم چندگزینه‌ای هم تشریحی)
    if (q.answers?.length) {
      card.append(
        el("div", { class: "section-title", text: "پاسخ‌ها" }),
        el(
          "div",
          { class: "stack", style: { gap: "6px" } },
          q.answers.map((a) => {
            const ansText = q.kind === "choice" ? (q.options[a.answer] ?? "—") : a.answer;
            return el("div", { class: "answer-row" }, el("b", { text: a.name + ":" }), el("span", { text: String(ansText) }));
          }),
        ),
      );
    }

    // کسانی که هنوز پاسخ نداده‌اند
    if (q.pending && q.pendingNames?.length) {
      card.append(
        el(
          "div",
          { class: "stack", style: { gap: "6px" } },
          el("span", { class: "hint", text: "هنوز پاسخ نداده‌اند:" }),
          el(
            "div",
            { class: "chips" },
            q.pendingNames.map((n) => el("span", { text: n })),
          ),
        ),
      );
    }

    card.append(
      el(
        "div",
        { class: "row" },
        q.open ? el("button", { class: "btn sm danger", onclick: () => this.call("qClose") }, ico("lock"), "بستن سؤال") : null,
        el(
          "button",
          { class: "btn sm" + (q.showResults ? " is-on" : ""), onclick: () => this.call("qResults", { show: !q.showResults }) },
          ico("users"),
          q.showResults ? "نتایج برای دانش‌آموزان نمایان است" : "نمایش نتایج به دانش‌آموزان",
        ),
        el("button", { class: "btn sm ghost", onclick: () => this.call("qClear") }, ico("x"), "حذف از کلاس"),
      ),
    );

    return card;
  }

  builder() {
    const d = this.draft;
    const box = el("div", { class: "qcard qbuilder" });

    const seg = el(
      "div",
      { class: "seg" },
      ["choice", "text"].map((k) =>
        el("button", { class: d.kind === k ? "is-on" : "", type: "button", onclick: () => ((d.kind = k), this.rebuild()) }, KIND_LABEL[k]),
      ),
    );

    const text = el("textarea", { class: "textarea", maxlength: "600", placeholder: "متن سؤال را بنویسید…" });
    text.value = d.text;
    text.addEventListener("input", () => (d.text = text.value));

    box.append(el("div", { class: "section-title", text: "سؤال جدید" }), seg, text);

    if (d.kind === "choice") {
      const list = el("div", { class: "stack", style: { gap: "8px" } });
      d.options.forEach((o, i) => {
        const inp = el("input", { class: "input", maxlength: "120", placeholder: "گزینهٔ " + faNum(i + 1) });
        inp.value = o;
        inp.addEventListener("input", () => (d.options[i] = inp.value));
        list.append(
          el(
            "div",
            { class: "opt-edit" },
            inp,
            d.options.length > 2
              ? el(
                  "button",
                  {
                    class: "btn icon-btn ghost",
                    type: "button",
                    title: "حذف گزینه",
                    onclick: () => {
                      d.options.splice(i, 1);
                      this.rebuild();
                    },
                  },
                  ico("x"),
                )
              : null,
          ),
        );
      });
      box.append(list);
      if (d.options.length < 6) {
        box.append(
          el(
            "button",
            {
              class: "btn sm ghost",
              type: "button",
              onclick: () => {
                d.options.push("");
                this.rebuild();
              },
            },
            ico("plus"),
            "افزودن گزینه",
          ),
        );
      }
    }

    const file = el("input", { type: "file", accept: "image/*", hidden: true });
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        let q = 0.82;
        let url = await downscaleImage(f, 1000, q);
        while (url.length > 480000 && q > 0.4) {
          q -= 0.12;
          url = await downscaleImage(f, 800, q);
        }
        d.image = url;
        this.rebuild();
      } catch {
        toast("تصویر خوانده نشد", "error");
      }
    });
    box.append(file);

    if (d.image) {
      box.append(
        el(
          "div",
          { class: "img-preview" },
          el("img", { src: d.image, alt: "" }),
          el(
            "button",
            {
              type: "button",
              title: "حذف تصویر",
              onclick: () => {
                d.image = null;
                this.rebuild();
              },
            },
            ico("x"),
          ),
        ),
      );
    } else {
      box.append(
        el("button", { class: "btn sm ghost", type: "button", onclick: () => file.click() }, ico("image"), "افزودن تصویر به سؤال"),
      );
    }

    box.append(el("button", { class: "btn primary block", type: "button", onclick: () => this.submit() }, ico("send"), "ارسال سؤال به کلاس"));
    return box;
  }

  rebuild() {
    this.render(this.q);
  }

  async submit() {
    const d = this.draft;
    const question = {
      kind: d.kind,
      text: d.text,
      options: d.kind === "choice" ? d.options : undefined,
      image: d.image || undefined,
    };
    try {
      await this.getSig().request("qCreate", { question });
      this.draft = { kind: d.kind, text: "", options: ["", "", "", ""], image: null };
      toast("سؤال برای کلاس ارسال شد", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  }
}

export class StudentQuestions {
  constructor(root, getSig, { onNew }) {
    this.root = root;
    this.getSig = getSig;
    this.onNew = onNew || (() => {});
    this.q = null;
    this.sel = null;
    this.text = "";
    this.render(null);
  }

  render(q) {
    const prev = this.q;
    this.q = q;
    if (q && q.id !== prev?.id) {
      this.sel = null;
      this.text = "";
      if (q.open && !q.answered) this.onNew(q);
    }
    this.root.textContent = "";
    if (!q) {
      this.root.append(
        el(
          "div",
          { class: "empty" },
          ico("help"),
          "سؤال فعالی وجود ندارد.",
          el("span", { class: "hint", text: "وقتی استاد سؤالی بفرستد، همین‌جا نمایش داده می‌شود." }),
        ),
      );
      return;
    }

    const card = el("div", { class: "qcard" + (q.open ? " open" : "") });
    card.append(
      el(
        "span",
        { class: "qstate" + (q.open ? "" : " closed") },
        el("span", { class: "dot " + (q.open ? "ok" : "") }),
        q.open ? "سؤال فعال" : "سؤال بسته شد",
      ),
      el("div", { class: "qtext", text: q.text }),
    );

    if (q.image) {
      card.append(el("img", { class: "qimg", src: q.image, alt: "تصویر سؤال", onclick: () => lightbox(q.image) }));
    }

    if (q.answered) {
      card.append(el("div", { class: "note-ok" }, ico("check"), "پاسخ شما ثبت شد و قابل ویرایش نیست."));
      card.append(
        el(
          "div",
          { class: "answer-row" },
          el("b", { text: "پاسخ شما:" }),
          el("span", { text: q.kind === "choice" ? q.options[q.myAnswer] : q.myAnswer }),
        ),
      );
    } else if (q.open) {
      if (q.kind === "choice") {
        card.append(
          el(
            "div",
            { class: "opts" },
            q.options.map((o, i) =>
              el(
                "button",
                {
                  class: "opt" + (this.sel === i ? " sel" : ""),
                  type: "button",
                  onclick: () => {
                    this.sel = i;
                    this.render(this.q);
                  },
                },
                el("span", { class: "mark" }, this.sel === i ? ico("check") : null),
                el("span", { text: o }),
              ),
            ),
          ),
        );
      } else {
        const ta = el("textarea", { class: "textarea", maxlength: "500", placeholder: "پاسخ خود را بنویسید…" });
        ta.value = this.text;
        ta.addEventListener("input", () => (this.text = ta.value));
        card.append(ta);
      }
      card.append(
        el("button", { class: "btn primary block", type: "button", onclick: () => this.submit() }, ico("send"), "ثبت پاسخ"),
        el("span", { class: "hint", text: "هر نفر فقط یک‌بار می‌تواند پاسخ بدهد." }),
      );
    } else {
      card.append(
        el(
          "div",
          { class: "note-ok", style: { color: "var(--muted)", background: "var(--bg-2)", borderColor: "var(--line)" } },
          ico("lock"),
          "مهلت پاسخ به این سؤال تمام شده است.",
        ),
      );
    }

    if (q.results) {
      card.append(el("div", { class: "section-title", text: "نتیجهٔ کلاس" }));
      if (q.kind === "choice") card.append(bars(q, q.results.counts, q.results.total));
      card.append(el("span", { class: "hint", text: faNum(q.results.total) + " نفر پاسخ داده‌اند" }));
    }

    this.root.append(card);
  }

  async submit() {
    const q = this.q;
    const answer = q.kind === "choice" ? this.sel : this.text.trim();
    if (answer === null || answer === undefined || answer === "") {
      return toast(q.kind === "choice" ? "یک گزینه را انتخاب کنید" : "پاسخ را بنویسید", "warn");
    }
    try {
      await this.getSig().request("qAnswer", { questionId: q.id, answer });
      toast("پاسخ شما ثبت شد", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  }
}