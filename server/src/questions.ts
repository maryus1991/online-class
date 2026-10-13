import { config } from "./config.ts";
import { cleanText } from "./chat.ts";
import { newId, type Peer, type Room } from "./rooms.ts";

export interface Answer {
  pid: string;
  name: string;
  answer: string | number;
  at: number;
}

export interface Question {
  id: string;
  kind: "text" | "choice";
  text: string;
  options: string[];
  image?: string;
  open: boolean;
  showResults: boolean;
  createdAt: number;
  /** کلید: clientId دانش‌آموز؛ برای جلوگیری از ارسال دوباره حتی پس از قطع و وصل شدن */
  answers: Map<string, Answer>;
}

export class QuestionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** هر سؤال جدید جایگزین سؤال قبلی می‌شود؛ در هر لحظه فقط یک سؤال در کلاس وجود دارد. */
export function createQuestion(room: Room, raw: any): void {
  const L = config.limits;
  const kind = raw?.kind === "choice" ? "choice" : raw?.kind === "text" ? "text" : null;
  if (!kind) throw new QuestionError("bad-question", "نوع سؤال نامعتبر است");
  const text = cleanText(raw.text, L.questionTextMax);
  if (!text) throw new QuestionError("bad-question", "متن سؤال را بنویسید");
  let options: string[] = [];
  if (kind === "choice") {
    if (!Array.isArray(raw.options)) throw new QuestionError("bad-question", "گزینه‌ها نامعتبرند");
    options = raw.options.slice(0, 6).map((o: unknown) => cleanText(o, L.questionOptionMax)).filter(Boolean);
    if (options.length < 2) throw new QuestionError("bad-question", "حداقل دو گزینه لازم است");
  }
  let image: string | undefined;
  if (raw.image !== undefined && raw.image !== null && raw.image !== "") {
    if (typeof raw.image !== "string" || raw.image.length > L.questionImageMaxBytes || !IMAGE_RE.test(raw.image)) {
      throw new QuestionError("bad-image", "تصویر نامعتبر است یا حجم آن بیش از حد مجاز است");
    }
    image = raw.image;
  }
  room.question = {
    id: newId(),
    kind,
    text,
    options,
    image,
    open: true,
    showResults: false,
    createdAt: Date.now(),
    answers: new Map(),
  };
  room.pushQuestion();
}

export function closeQuestion(room: Room): void {
  const q = room.question;
  if (!q) throw new QuestionError("no-question", "سؤال فعالی وجود ندارد");
  q.open = false;
  room.pushQuestion();
}

export function setShowResults(room: Room, show: boolean): void {
  const q = room.question;
  if (!q) throw new QuestionError("no-question", "سؤال فعالی وجود ندارد");
  q.showResults = show;
  room.pushQuestion();
}

export function clearQuestion(room: Room): void {
  room.question = null;
  room.pushQuestion();
}

export function answerQuestion(room: Room, peer: Peer, raw: any): void {
  const q = room.question;
  if (!q || raw?.questionId !== q.id) throw new QuestionError("no-question", "این سؤال دیگر فعال نیست");
  if (!q.open) throw new QuestionError("closed", "مهلت پاسخ به این سؤال تمام شده است");
  if (q.answers.has(peer.clientId)) throw new QuestionError("already-answered", "شما قبلاً به این سؤال پاسخ داده‌اید");
  let answer: string | number;
  if (q.kind === "choice") {
    const i = raw.answer;
    if (!Number.isInteger(i) || i < 0 || i >= q.options.length) throw new QuestionError("bad-answer", "گزینهٔ انتخابی نامعتبر است");
    answer = i;
  } else {
    answer = cleanText(raw.answer, config.limits.answerMax);
    if (!answer) throw new QuestionError("bad-answer", "پاسخ را بنویسید");
  }
  // ثبت هم‌زمان و تک‌نخی: دو ارسال پشت‌سرهم هرگز دو پاسخ ثبت نمی‌کنند.
  q.answers.set(peer.clientId, { pid: peer.pid, name: peer.name, answer, at: Date.now() });
  room.send(peer, { t: "question", question: questionViewFor(room, peer) });
  room.scheduleQuestionUpdate();
}

function optionCounts(q: Question): number[] {
  const counts = q.options.map(() => 0);
  for (const a of q.answers.values()) if (typeof a.answer === "number") counts[a.answer]++;
  return counts;
}

/** نمای سؤال برای هر نقش: دانش‌آموز هیچ‌وقت پاسخ دیگران را نمی‌بیند. */
export function questionViewFor(room: Room, viewer: Peer) {
  const q = room.question;
  if (!q) return null;
  const base = {
    id: q.id,
    kind: q.kind,
    text: q.text,
    options: q.options,
    image: q.image,
    open: q.open,
    showResults: q.showResults,
  };
  const online = room.students;
  const answeredOnline = online.filter((p) => q.answers.has(p.clientId));
  if (viewer.role === "teacher") {
    return {
      ...base,
      online: online.length,
      answered: answeredOnline.length,
      pending: online.length - answeredOnline.length,
      pendingNames: online.filter((p) => !q.answers.has(p.clientId)).map((p) => p.name),
      answers: [...q.answers.values()].map((a) => ({ pid: a.pid, name: a.name, answer: a.answer })),
      counts: q.kind === "choice" ? optionCounts(q) : undefined,
    };
  }
  const mine = q.answers.get(viewer.clientId);
  return {
    ...base,
    answered: Boolean(mine),
    myAnswer: mine?.answer,
    results: q.showResults
      ? { total: q.answers.size, counts: q.kind === "choice" ? optionCounts(q) : undefined }
      : undefined,
  };
}
