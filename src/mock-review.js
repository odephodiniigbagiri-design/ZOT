import "./site.js";
import "./mock.css";
import { supabase } from "./supabase.js";
import { el, fmtCountdown, fmtDuration, clockOffset, requireStudent } from "./mock-common.js";

const app = document.getElementById("app");
const attemptId = new URLSearchParams(location.search).get("attempt");

app.innerHTML = `
  <main class="auth-card auth-card--wide">
    <span class="chip">Mock Challenge</span>
    <section id="rvMsg" class="status">Loading…</section>
    <section id="rvBody" class="stack" hidden></section>
  </main>`;
const msg = document.getElementById("rvMsg");
const body = document.getElementById("rvBody");

const back = () => el("a", { class: "btn btn--alt mc-btn", href: "/mocks.html", text: "Back to Mock Challenge" });

function waiting(r) {
  const offset = clockOffset(r.server_now);
  const at = Date.parse(r.results_at);
  const big = el("p", { class: "mc-big", text: fmtCountdown(at - (Date.now() + offset)) });
  body.replaceChildren(
    el("h1", { text: "Mock submitted ✓" }),
    el("p", { class: "lede", text: `${r.title}: your answers are in. Your score, corrections and the leaderboard open in:` }),
    el("div", { class: "mc-hero" }, big),
    el("p", { class: "lede", text: "You can close this page. Your results will be waiting in My history." }),
    back());
  body.hidden = false; msg.hidden = true;
  const id = setInterval(() => {
    const left = at - (Date.now() + offset);
    big.textContent = fmtCountdown(left);
    if (left <= 0) { clearInterval(id); load(); }
  }, 1000);
}

function pickLabel(q, k) { return k ? `${k}. ${q.options[k]}` : "No answer"; }

function reviewList(r, filter) {
  const box = el("div", { class: "mc-list" });
  let n = 0;
  const bySubject = {};
  for (const q of r.questions) {
    bySubject[q.subject] = (bySubject[q.subject] || 0) + 1;
    if (filter !== "All" && q.subject !== filter) continue;
    n++;
    const status = !q.chosen ? "skipped" : q.chosen === q.correct ? "right" : "wrong";
    const card = el("article", { class: "mc-q", "data-s": status },
      el("p", { class: "mc-q__h", text: `${q.subject} · Question ${bySubject[q.subject]}` }),
      el("p", { class: "mc-q__t", text: q.question }),
      el("p", { class: "mc-q__a", "data-s": status, text: `Your answer: ${pickLabel(q, q.chosen)}` }));
    if (status !== "right") card.append(el("p", { class: "mc-q__c", text: `Correct answer: ${pickLabel(q, q.correct)}` }));
    if (q.explanation) card.append(el("p", { class: "mc-q__e", text: `Explanation: ${q.explanation}` }));
    box.append(card);
  }
  if (!n) box.textContent = "No questions.";
  return box;
}

async function leaderboardView(r) {
  const holder = el("div", {}, el("p", { class: "status", text: "Loading leaderboard…" }));
  supabase.rpc("zot_mock_leaderboard", { p_challenge: r.challenge_id }).then(({ data, error }) => {
    if (error) { holder.replaceChildren(el("p", { class: "status", text: error.message })); return; }
    const rows = Array.isArray(data) ? data : [];
    const table = el("table", { class: "mc-table" });
    table.append(el("thead", {}, el("tr", {}, ...["#", "Student", "Track", "Score"].map((h) => el("th", { text: h })))));
    const tb = el("tbody");
    for (const x of rows) {
      const who = el("td", {}, el("strong", { text: x.full_name }),
        el("small", { text: `${x.course} · ${(x.subjects || []).map((s) => s.replace("Mathematics", "Maths")).join(", ")}` }));
      tb.append(el("tr", { class: x.is_me ? "is-me" : "" },
        el("td", { text: String(x.rank) }), who, el("td", { text: x.track }), el("td", { text: String(x.score) })));
    }
    table.append(tb);
    holder.replaceChildren(
      el("p", { class: "lede", text: `${rows.length} student${rows.length === 1 ? "" : "s"} · ranked by score, then speed. Scores are out of 400.` }),
      el("div", { class: "mc-table-wrap" }, table));
  });
  return holder;
}

function results(r) {
  const head = el("div", { class: "mc-score" },
    el("p", { class: "mc-score__k", text: r.title }),
    el("p", { class: "mc-score__n", text: `${r.score}/${r.out_of}` }),
    el("p", { class: "mc-score__s", text: `Rank #${r.rank} of ${r.participants} · ${r.correct_count} correct · ${fmtDuration(r.time_taken_seconds)}` }),
    el("p", { class: "mc-score__s", text: `${r.full_name} · ${r.course} · ${r.track}` }));

  const subj = el("div", { class: "mc-bars" });
  for (const [s, v] of Object.entries(r.subject_scores || {})) {
    subj.append(el("div", { class: "mc-bar" },
      el("span", { text: `${s} (${v.correct}/${v.total})` }),
      el("div", { class: "mc-bar__track" }, Object.assign(el("div", { class: "mc-bar__fill" }), { style: `width:${v.score}%` })),
      el("strong", { text: String(v.score) })));
  }

  const tabs = el("div", { class: "mc-tabs" });
  const view = el("div");
  const filters = ["Leaderboard", "All", ...Object.keys(r.subject_scores || {})];
  const show = async (f) => {
    for (const b of tabs.children) b.classList.toggle("is-on", b.dataset.f === f);
    view.replaceChildren(f === "Leaderboard" ? await leaderboardView(r) : reviewList(r, f));
  };
  for (const f of filters) {
    const b = el("button", { type: "button", class: "mc-tab", text: f === "All" ? "All answers" : f });
    b.dataset.f = f;
    b.addEventListener("click", () => show(f));
    tabs.append(b);
  }
  body.replaceChildren(head, subj, el("h3", { class: "section-title", text: "Leaderboard and corrections" }), tabs, view, back());
  body.hidden = false; msg.hidden = true;
  show("Leaderboard");
}

async function load() {
  const { data, error } = await supabase.rpc("zot_mock_result", { p_attempt: attemptId });
  if (error) {
    if (/in progress/i.test(error.message)) return window.location.replace(`/mock-exam.html?attempt=${attemptId}`);
    msg.textContent = error.message; return;
  }
  data.released ? results(data) : waiting(data);
}

(async () => {
  if (!attemptId) { msg.textContent = "No mock selected."; return; }
  const user = await requireStudent(msg);
  if (user) load().catch((e) => { console.error(e); msg.textContent = "We couldn't load your results. Please refresh."; });
})();
