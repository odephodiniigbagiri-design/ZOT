import "./mock.css";
import { supabase } from "./supabase.js";
import { el, clockOffset } from "./mock-common.js";

const app = document.getElementById("app");
const attemptId = new URLSearchParams(location.search).get("attempt");

const short = { "English Language": "English", Mathematics: "Maths" };
const tabName = (s) => short[s] || s;

let qs = [], subjects = [], answers = {}, idx = 0, offset = 0, endsAt = 0;
let finishing = false, dirty = false;
const pending = new Map();

function fail(text) {
  app.replaceChildren(el("main", { class: "mx-fail" }, el("p", { text }),
    el("a", { class: "mx-btn", href: "/mocks.html", text: "Back to Mock Challenge" })));
}

function layout(title) {
  app.innerHTML = `
  <div class="mx">
    <header class="mx-top">
      <button class="mx-ic" id="mxBack" type="button" aria-label="Leave">←</button>
      <div class="mx-title"></div>
      <div class="mx-timer" id="mxTimer">--:--:--</div>
    </header>
    <nav class="mx-tabs" id="mxTabs"></nav>
    <div class="mx-qbar">
      <button class="mx-nav" id="mxPrev" type="button" aria-label="Previous">‹</button>
      <div class="mx-qpill" id="mxPill"></div>
      <button class="mx-nav" id="mxNext" type="button" aria-label="Next">›</button>
    </div>
    <article class="mx-q">
      <p class="mx-text" id="mxText"></p>
      <div class="mx-opts" id="mxOpts"></div>
    </article>
    <div class="mx-sync" id="mxSync" hidden>Saving… check your network</div>
    <footer class="mx-foot">
      <button class="mx-count" id="mxPalette" type="button">⌃ <span id="mxCount">0/0</span></button>
      <button class="mx-submit" id="mxSubmit" type="button">✓ Submit</button>
    </footer>
    <section class="mx-sheet" id="mxSheet" hidden></section>
    <div class="mx-modal" id="mxModal" hidden><div class="mx-modal__box" id="mxModalBox"></div></div>
  </div>`;
  app.querySelector(".mx-title").textContent = title || "Mock Challenge";
}

function modal(html, actions) {
  const box = document.getElementById("mxModalBox");
  box.replaceChildren(el("p", { text: html }));
  const row = el("div", { class: "mx-modal__row" });
  for (const a of actions) {
    const b = el("button", { type: "button", class: a.primary ? "mx-btn" : "mx-btn mx-btn--alt", text: a.text });
    b.addEventListener("click", () => { document.getElementById("mxModal").hidden = true; a.fn?.(); });
    row.append(b);
  }
  box.append(row);
  document.getElementById("mxModal").hidden = false;
}

function answeredCount() { return Object.keys(answers).length; }

function renderTabs() {
  const tabs = document.getElementById("mxTabs");
  tabs.replaceChildren();
  const cur = qs[idx].subject;
  for (const s of subjects) {
    const b = el("button", { type: "button", class: "mx-tab" + (s === cur ? " is-on" : ""), text: tabName(s) });
    b.addEventListener("click", () => go(qs.findIndex((q) => q.subject === s)));
    tabs.append(b);
  }
}

function renderQuestion() {
  const q = qs[idx];
  const inSubject = qs.filter((x) => x.subject === q.subject);
  const posInSubject = inSubject.indexOf(q) + 1;
  document.getElementById("mxPill").textContent = `Question ${posInSubject}/${inSubject.length}`;
  document.getElementById("mxText").textContent = q.question;
  const opts = document.getElementById("mxOpts");
  opts.replaceChildren();
  for (const k of ["A", "B", "C", "D"]) {
    const b = el("button", { type: "button", class: "mx-opt" + (answers[q.id] === k ? " is-on" : "") },
      el("b", { text: k }), el("span", { class: "mx-radio" }), el("span", { class: "mx-opt__t", text: q.options[k] }));
    b.addEventListener("click", () => choose(q, k));
    opts.append(b);
  }
  document.getElementById("mxCount").textContent = `${answeredCount()}/${qs.length}`;
  document.getElementById("mxPrev").disabled = idx === 0;
  document.getElementById("mxNext").disabled = idx === qs.length - 1;
  renderTabs();
}

function go(i) {
  if (i < 0 || i >= qs.length) return;
  idx = i;
  renderQuestion();
  document.getElementById("mxSheet").hidden = true;
}

function renderSheet() {
  const sheet = document.getElementById("mxSheet");
  sheet.replaceChildren(el("p", { class: "mx-sheet__h", text: "Question list. Tap a number to jump." }));
  for (const s of subjects) {
    sheet.append(el("p", { class: "mx-sheet__s", text: s }));
    const grid = el("div", { class: "mx-grid" });
    qs.forEach((q, i) => {
      if (q.subject !== s) return;
      const b = el("button", {
        type: "button",
        class: "mx-num" + (answers[q.id] ? " is-done" : "") + (i === idx ? " is-cur" : ""),
        text: String(qs.filter((x) => x.subject === s).indexOf(q) + 1),
      });
      b.addEventListener("click", () => go(i));
      grid.append(b);
    });
    sheet.append(grid);
  }
}

function choose(q, k) {
  if (finishing) return;
  answers[q.id] = k;
  dirty = true;
  pending.set(q.id, k);
  renderQuestion();
  flush();
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  const sync = document.getElementById("mxSync");
  try {
    while (pending.size) {
      const [qid, k] = pending.entries().next().value;
      const { error } = await supabase.rpc("zot_mock_save_answer", {
        p_attempt: attemptId, p_question: qid, p_choice: k,
      });
      if (error) {
        if (/time is up|submitted/i.test(error.message)) { pending.clear(); break; }
        sync.hidden = false;
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (pending.get(qid) === k) pending.delete(qid);
    }
    sync.hidden = true;
  } finally {
    flushing = false;
  }
}

async function finish(auto) {
  if (finishing) return;
  finishing = true;
  dirty = false;
  modal(auto ? "Time is up. Submitting your answers…" : "Submitting your answers…", []);
  const t0 = Date.now();
  while ((pending.size || flushing) && Date.now() - t0 < 8000) {
    flush();
    await new Promise((r) => setTimeout(r, 300));
  }
  const { error } = await supabase.rpc("zot_mock_submit", { p_attempt: attemptId });
  if (error) {
    finishing = false;
    return modal(`Could not submit: ${error.message}. Check your network and try again.`,
      [{ text: "Try again", primary: true, fn: () => finish(auto) }]);
  }
  window.location.replace(`/mock-review.html?attempt=${attemptId}`);
}

function confirmSubmit() {
  const left = qs.length - answeredCount();
  const text = left > 0
    ? `You have ${left} unanswered question${left > 1 ? "s" : ""}. Submit anyway? You cannot change your answers after this.`
    : "Submit your mock now? You cannot change your answers after this.";
  modal(text, [{ text: "Keep working" }, { text: "Submit", primary: true, fn: () => finish(false) }]);
}

function startTimer() {
  const t = document.getElementById("mxTimer");
  const tick = () => {
    const left = Math.max(0, endsAt - (Date.now() + offset));
    const s = Math.floor(left / 1000);
    const p = (x) => String(x).padStart(2, "0");
    t.textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
    t.classList.toggle("is-low", left <= 5 * 60 * 1000);
    if (left <= 0) finish(true);
  };
  tick();
  setInterval(tick, 1000);
}

document.addEventListener("keydown", (e) => {
  if (!qs.length || finishing || !document.getElementById("mxModal")?.hidden) return;
  const k = e.key.toUpperCase();
  if (["A", "B", "C", "D"].includes(k)) choose(qs[idx], k);
  else if (e.key === "ArrowRight") go(idx + 1);
  else if (e.key === "ArrowLeft") go(idx - 1);
});
window.addEventListener("beforeunload", (e) => { if (dirty && !finishing) { e.preventDefault(); e.returnValue = ""; } });

(async () => {
  if (!attemptId) return fail("No mock selected.");
  const { data, error } = await supabase.rpc("zot_mock_get_attempt", { p_attempt: attemptId });
  if (error) return fail(error.message.includes("sign in") ? "Please sign in to continue." : error.message);
  if (data.status === "submitted") return window.location.replace(`/mock-review.html?attempt=${attemptId}`);

  qs = data.questions;
  subjects = data.subjects.filter((s) => qs.some((q) => q.subject === s));
  answers = data.answers || {};
  offset = clockOffset(data.server_now);
  endsAt = Date.parse(data.ends_at);
  if (!qs.length) return fail("This mock has no questions yet.");

  layout(data.title);
  document.getElementById("mxBack").addEventListener("click", () =>
    modal("Leave the exam screen? Your timer keeps running and you can continue from the Mock Challenge page.",
      [{ text: "Stay" }, { text: "Leave", primary: true, fn: () => { dirty = false; location.href = "/mocks.html"; } }]));
  document.getElementById("mxPrev").addEventListener("click", () => go(idx - 1));
  document.getElementById("mxNext").addEventListener("click", () => go(idx + 1));
  document.getElementById("mxSubmit").addEventListener("click", confirmSubmit);
  document.getElementById("mxPalette").addEventListener("click", () => {
    const sheet = document.getElementById("mxSheet");
    if (sheet.hidden) renderSheet();
    sheet.hidden = !sheet.hidden;
  });
  renderQuestion();
  startTimer();
})();
