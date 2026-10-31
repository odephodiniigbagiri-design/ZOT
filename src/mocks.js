import "./site.js";
import "./mock.css";
import { supabase } from "./supabase.js";
import {
  ROUND_COUNT, scheduledStart, el, fmtDate, fmtCountdown, clockOffset, requireStudent,
} from "./mock-common.js";

const app = document.getElementById("app");
app.innerHTML = `
  <main class="auth-card auth-card--wide">
    <span class="chip">Mock Challenge</span>
    <h1>Mock Challenge</h1>
    <p class="lede">A new mock every Sunday. Everyone writes the same questions and everyone is ranked on one leaderboard.</p>
    <section id="mcMsg" class="status">Loading…</section>
    <section id="mcBody" class="stack" hidden>
      <div id="mcNext"></div>
      <div id="mcForm"></div>
      <h3 class="section-title">All rounds</h3>
      <div id="mcRounds" class="mc-list"></div>
      <h3 class="section-title">My history</h3>
      <div id="mcHistory" class="mc-list"></div>
      <a class="btn btn--alt mc-btn" href="/student-dashboard.html">Back to dashboard</a>
    </section>
  </main>`;

const msg = document.getElementById("mcMsg");
const body = document.getElementById("mcBody");
let rows = [];
let offset = 0;
let reloading = false;
let profileName = "";
const nowMs = () => Date.now() + offset;

function stateOf(round) {
  const ch = rows.find((r) => r.round_no === round);
  if (!ch) return { kind: "pending", start: scheduledStart(round) };
  const start = Date.parse(ch.starts_at);
  const closes = Date.parse(ch.closes_at);
  const now = nowMs();
  if (ch.attempt_id) {
    if (ch.submitted_at) return { kind: "submitted", ch, start };
    if (now < Date.parse(ch.attempt_ends_at)) return { kind: "inprogress", ch, start };
    return { kind: "submitted", ch, start };
  }
  if (now < start) return { kind: "upcoming", ch, start };
  if (now <= closes) return { kind: "open", ch, start };
  return { kind: "missed", ch, start };
}

function countdownSpan(targetMs) {
  const s = el("strong", { class: "mc-cd" });
  s.dataset.cd = String(targetMs);
  s.textContent = fmtCountdown(targetMs - nowMs());
  return s;
}

function resultsText(ch) {
  const at = Date.parse(ch.results_at);
  if (nowMs() >= at) return ch.score != null ? `Score: ${ch.score}/400` : "Results ready";
  return `Results at ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function renderNext() {
  const box = document.getElementById("mcNext");
  box.replaceChildren();
  for (let n = 1; n <= ROUND_COUNT; n++) {
    const st = stateOf(n);
    if (st.kind === "inprogress") {
      box.append(el("div", { class: "mc-hero" },
        el("p", { class: "mc-hero__k", text: `Round ${n} is in progress` }),
        el("a", { class: "btn mc-btn", href: `/mock-exam.html?attempt=${st.ch.attempt_id}`, text: "Continue your mock" })));
      return;
    }
    if (st.kind === "open") {
      box.append(el("div", { class: "mc-hero" },
        el("p", { class: "mc-hero__k", text: `Round ${n} is open now` }),
        el("p", { class: "mc-hero__s", text: `${st.ch.duration_minutes} minutes. The timer starts as soon as you begin.` }),
        el("button", { class: "btn", type: "button", id: `start${n}`, text: "Start Mock" })));
      box.querySelector(`#start${n}`).addEventListener("click", () => openForm(st.ch));
      return;
    }
    if (st.kind === "upcoming") {
      const hero = el("div", { class: "mc-hero" },
        el("p", { class: "mc-hero__k", text: `Round ${n} starts in` }));
      const big = countdownSpan(st.start); big.className = "mc-big";
      hero.append(big, el("p", { class: "mc-hero__s", text: fmtDate(st.start) }));
      box.append(hero);
      return;
    }
    if (st.kind === "pending") {
      box.append(el("div", { class: "mc-hero" },
        el("p", { class: "mc-hero__k", text: `Next: Round ${n}` }),
        el("p", { class: "mc-hero__s", text: `${fmtDate(st.start)} · Pending. The mock is not published yet.` })));
      return;
    }
  }
}

function renderRounds() {
  const list = document.getElementById("mcRounds");
  list.replaceChildren();
  for (let n = 1; n <= ROUND_COUNT; n++) {
    const st = stateOf(n);
    const left = el("div", {}, el("h4", { text: `Round ${n}` }));
    const right = el("div", { class: "mc-right" });
    const pill = (k, t) => el("span", { class: "mc-pill", "data-k": k, text: t });
    const start = st.ch ? Date.parse(st.ch.starts_at) : st.start;
    left.append(el("p", { text: fmtDate(start) }));

    if (st.kind === "pending") right.append(pill("pending", "Pending"));
    else if (st.kind === "upcoming") {
      right.append(pill("upcoming", "Upcoming"));
      const p = el("p", { class: "mc-note" }, "Starts in ", countdownSpan(st.start));
      right.append(p);
    } else if (st.kind === "open") {
      right.append(pill("open", "Open now"));
      const b = el("button", { class: "btn", type: "button", text: "Start" });
      b.addEventListener("click", () => openForm(st.ch));
      right.append(b);
    } else if (st.kind === "inprogress") {
      right.append(pill("open", "In progress"),
        el("a", { class: "btn mc-btn", href: `/mock-exam.html?attempt=${st.ch.attempt_id}`, text: "Continue" }));
    } else if (st.kind === "submitted") {
      right.append(pill("done", "Submitted"), el("p", { class: "mc-note", text: resultsText(st.ch) }));
    } else if (st.kind === "missed") {
      right.append(pill("missed", "Closed"));
    }
    list.append(el("div", { class: "mc-row" }, left, right));
  }
}

function renderHistory() {
  const list = document.getElementById("mcHistory");
  list.replaceChildren();
  const done = rows.filter((r) => r.attempt_id && (r.submitted_at || nowMs() >= Date.parse(r.attempt_ends_at)));
  if (!done.length) {
    list.textContent = "You have not taken a mock yet. Your results and corrections will stay here.";
    return;
  }
  for (const ch of done.sort((a, b) => b.round_no - a.round_no)) {
    const released = ch.results_at && nowMs() >= Date.parse(ch.results_at);
    const left = el("div", {}, el("h4", { text: `Round ${ch.round_no}` }),
      el("p", { text: released && ch.score != null ? `Score: ${ch.score}/400` : resultsText(ch) }));
    const link = el("a", {
      class: "btn btn--alt mc-btn", href: `/mock-review.html?attempt=${ch.attempt_id}`,
      text: released ? "View results & corrections" : "Open",
    });
    list.append(el("div", { class: "mc-row" }, left, link));
  }
}

function render() {
  renderNext();
  renderRounds();
  renderHistory();
}

async function openForm(ch) {
  const box = document.getElementById("mcForm");
  box.replaceChildren(el("p", { class: "status", text: "Loading subjects…" }));
  const { data, error } = await supabase.rpc("zot_mock_subjects", { p_challenge: ch.id });
  if (error) { box.replaceChildren(el("p", { class: "status", text: error.message })); return; }

  const subjects = Array.isArray(data) ? data : [];
  const name = el("input", { class: "input", maxlength: "120", placeholder: "Your full name", autocomplete: "name" });
  name.value = profileName;
  const course = el("input", { class: "input", maxlength: "120", placeholder: "e.g. Medicine and Surgery" });
  const checks = subjects.map((s) => {
    const cb = el("input", { type: "checkbox", value: s });
    return { s, cb, label: el("label", { class: "mc-check" }, cb, el("span", { text: s })) };
  });
  const err = el("p", { class: "status", hidden: "" });
  const go = el("button", { class: "btn btn--block", type: "button", text: `Start now (${ch.duration_minutes} min)` });

  const chosen = () => checks.filter((c) => c.cb.checked);
  for (const c of checks) {
    c.cb.addEventListener("change", () => {
      const full = chosen().length >= 3;
      for (const o of checks) o.cb.disabled = full && !o.cb.checked;
    });
  }
  go.addEventListener("click", async () => {
    err.hidden = true;
    if (name.value.trim().length < 2) return showErr("Enter your full name.");
    if (course.value.trim().length < 2) return showErr("Enter the course you are applying for.");
    if (chosen().length !== 3) return showErr("Choose exactly 3 subjects. English is already included.");
    go.disabled = true;
    const { data: res, error: e } = await supabase.rpc("zot_mock_start", {
      p_challenge: ch.id, p_full_name: name.value.trim(), p_course: course.value.trim(),
      p_subjects: chosen().map((c) => c.s),
    });
    if (e) { go.disabled = false; return showErr(e.message); }
    window.location.href = `/mock-exam.html?attempt=${res.attempt_id}`;
  });
  function showErr(t) { err.textContent = t; err.hidden = false; }

  box.replaceChildren(el("div", { class: "mc-form" },
    el("h3", { text: `Round ${ch.round_no}: your details` }),
    el("p", { class: "lede", text: "These appear on the leaderboard so everyone can see who is who." }),
    el("label", { class: "field-label", text: "Full name" }), name,
    el("label", { class: "field-label", text: "Course you are applying for" }), course,
    el("label", { class: "field-label", text: "Choose 3 subjects (English is compulsory)" }),
    el("label", { class: "mc-check" }, el("input", { type: "checkbox", checked: "", disabled: "" }),
      el("span", { text: "English Language (compulsory)" })),
    ...checks.map((c) => c.label), err, go));
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function load() {
  const { data, error } = await supabase.rpc("zot_mock_list");
  if (error) throw error;
  rows = Array.isArray(data) ? data : [];
  offset = rows.length ? clockOffset(rows[0].server_now) : 0;
  render();
}

setInterval(() => {
  let due = false;
  for (const n of document.querySelectorAll("[data-cd]")) {
    const left = Number(n.dataset.cd) - nowMs();
    n.textContent = fmtCountdown(left);
    if (left <= 0) due = true;
  }
  if (due && !reloading) {
    reloading = true;
    load().catch(console.error).finally(() => setTimeout(() => (reloading = false), 3000));
  }
}, 1000);

(async () => {
  const user = await requireStudent(msg);
  if (!user) return;
  try {
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    profileName = profile?.full_name || "";
    await load();
    msg.hidden = true;
    body.hidden = false;
  } catch (e) {
    console.error("Mock Challenge error:", e);
    msg.textContent = "We couldn't load the Mock Challenge. Please refresh, or contact the ZOT administrator.";
  }
})();
