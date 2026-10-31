import "./site.js";
import "./mock.css";
import { supabase } from "./supabase.js";
import { el, fmtDate, fmtDuration } from "./mock-common.js";

const app = document.getElementById("app");
app.innerHTML = `
  <main class="auth-card auth-card--wide">
    <span class="chip">Admin</span>
    <h1>Mock Challenge</h1>
    <p id="amMsg" class="status">Checking access…</p>
    <section id="amBody" class="stack" hidden>
      <a class="btn btn--alt mc-btn" href="/admin-dashboard.html">← Admin dashboard</a>

      <h3 class="section-title">Rounds</h3>
      <div id="amRounds" class="mc-list"></div>

      <h3 class="section-title" id="amFormTitle">Create a round</h3>
      <div class="mc-form">
        <input type="hidden" id="amId" />
        <label class="field-label">Round number</label><input class="input" id="amRound" type="number" min="1" />
        <label class="field-label">Title</label><input class="input" id="amTitle" maxlength="120" placeholder="Mock Challenge: Round 2" />
        <label class="field-label">Starts</label><input class="input" id="amStart" type="datetime-local" />
        <label class="field-label">Last time students can start</label><input class="input" id="amClose" type="datetime-local" />
        <label class="field-label">Exam length (minutes)</label><input class="input" id="amDur" type="number" min="5" max="300" value="45" />
        <label class="field-label">Results open this many minutes after submitting</label><input class="input" id="amDelay" type="number" min="0" max="1440" value="30" />
        <label class="mc-check"><input type="checkbox" id="amPub" /><span>Published (students can see it and the countdown starts)</span></label>
        <button class="btn btn--block" id="amSave" type="button">Save round</button>
        <button class="btn btn--alt btn--block" id="amReset" type="button" hidden>Cancel editing</button>
      </div>

      <h3 class="section-title">Upload questions</h3>
      <div class="mc-form">
        <label class="field-label">Round</label><select class="input" id="amQRound"></select>
        <label class="field-label">Upload a .txt, .md or .json file, or paste the questions</label>
        <input class="input" id="amFile" type="file" accept=".txt,.md,.json,text/plain" />
        <textarea class="input" id="amText" rows="10" placeholder="### 1. PHYSICS&#10;1. Question text&#10;A. one B. two C. three D. four&#10;Answer: B. two&#10;Explanation: why"></textarea>
        <label class="mc-check"><input type="checkbox" id="amReplace" /><span>Replace all existing questions in this round</span></label>
        <p class="lede">Format: a heading per subject, then numbered questions with options A to D, an Answer line and an optional Explanation line. A JSON list also works. English Language must be one of the subjects.</p>
        <button class="btn btn--alt btn--block" id="amPreview" type="button">Check questions</button>
        <div id="amPreviewOut" class="status" hidden></div>
        <button class="btn btn--block" id="amImport" type="button" hidden>Import these questions</button>
      </div>

      <h3 class="section-title">Leaderboard and results</h3>
      <div class="mc-form">
        <label class="field-label">Round</label><select class="input" id="amLRound"></select>
        <button class="btn btn--alt btn--block" id="amLoad" type="button">Show leaderboard</button>
      </div>
      <div id="amBoard"></div>
    </section>
  </main>`;

const $ = (id) => document.getElementById(id);
const msg = $("amMsg");
let rounds = [];
let parsed = null;

function say(t, ok) { msg.hidden = false; msg.textContent = t; msg.className = "status" + (ok ? "" : " error"); }

async function requireAdmin() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.replace("/admin.html"); return false; }
  const { data: role, error } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id).maybeSingle();
  if (error || role?.role !== "main_admin") { await supabase.auth.signOut(); location.replace("/admin.html"); return false; }
  return true;
}

const toLocalInput = (iso) => {
  const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function resetForm() {
  $("amId").value = ""; $("amFormTitle").textContent = "Create a round"; $("amReset").hidden = true;
  const next = Math.max(0, ...rounds.map((r) => r.round_no)) + 1;
  $("amRound").value = next; $("amTitle").value = `Mock Challenge: Round ${next}`;
  const last = rounds.length ? Date.parse(rounds[rounds.length - 1].starts_at) + 7 * 86400000 : Date.parse("2026-12-13T10:00:00+01:00");
  $("amStart").value = toLocalInput(new Date(last).toISOString());
  $("amClose").value = toLocalInput(new Date(last + 3 * 3600000).toISOString());
  $("amDur").value = 45; $("amDelay").value = 30; $("amPub").checked = false;
}

function editRound(r) {
  $("amId").value = r.id; $("amFormTitle").textContent = `Edit Round ${r.round_no}`; $("amReset").hidden = false;
  $("amRound").value = r.round_no; $("amTitle").value = r.title;
  $("amStart").value = toLocalInput(r.starts_at); $("amClose").value = toLocalInput(r.closes_at);
  $("amDur").value = r.duration_minutes; $("amDelay").value = r.release_delay_minutes; $("amPub").checked = r.published;
  $("amFormTitle").scrollIntoView({ behavior: "smooth" });
}

function renderRounds() {
  const list = $("amRounds"); list.replaceChildren();
  for (const sel of [$("amQRound"), $("amLRound")]) {
    sel.replaceChildren(...rounds.map((r) => el("option", { value: r.id, text: `Round ${r.round_no}: ${r.title}` })));
  }
  if (!rounds.length) { list.textContent = "No rounds yet. Create one below."; return; }
  for (const r of rounds) {
    const counts = Object.entries(r.question_counts || {}).map(([s, n]) => `${s} ${n}`).join(" · ") || "No questions yet";
    const left = el("div", {}, el("h4", { text: `Round ${r.round_no}: ${r.title}` }),
      el("p", { text: `${fmtDate(Date.parse(r.starts_at))} · ${r.duration_minutes} min` }),
      el("p", { text: counts }),
      el("p", { text: `${r.submitted} submitted of ${r.attempts} started` }));
    const right = el("div", { class: "mc-right" },
      el("span", { class: "mc-pill", "data-k": r.published ? "open" : "pending", text: r.published ? "Published" : "Draft" }));
    const b = el("button", { class: "btn btn--alt", type: "button", text: "Edit" });
    b.addEventListener("click", () => editRound(r));
    right.append(b);
    list.append(el("div", { class: "mc-row" }, left, right));
  }
}

async function load() {
  const { data, error } = await supabase.rpc("zot_admin_mock_list");
  if (error) throw error;
  rounds = data || [];
  renderRounds();
  if (!$("amId").value) resetForm();
}

$("amReset").addEventListener("click", resetForm);
$("amSave").addEventListener("click", async () => {
  try {
    const { error } = await supabase.rpc("zot_admin_mock_save", {
      p_id: $("amId").value || null, p_round_no: Number($("amRound").value), p_title: $("amTitle").value.trim(),
      p_starts_at: new Date($("amStart").value).toISOString(), p_closes_at: new Date($("amClose").value).toISOString(),
      p_duration: Number($("amDur").value), p_release_delay: Number($("amDelay").value), p_published: $("amPub").checked,
    });
    if (error) throw error;
    $("amId").value = ""; await load(); resetForm(); say("Round saved.", true);
  } catch (e) { say(`Could not save: ${e.message}`); }
});

// ---- question parsing ----
const NAMES = { "ENGLISH LANGUAGE": "English Language", ENGLISH: "English Language", MATHEMATICS: "Mathematics",
  "CHRISTIAN RELIGIOUS STUDIES (CRS)": "CRS", "CHRISTIAN RELIGIOUS STUDIES": "CRS" };
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function parseText(raw) {
  const text = raw.trim();
  if (text.startsWith("[")) {
    return JSON.parse(text).map((q) => ({
      subject: q.subject, question: q.question, a: q.a ?? q.options?.A, b: q.b ?? q.options?.B,
      c: q.c ?? q.options?.C, d: q.d ?? q.options?.D, correct: q.correct ?? q.answer, explanation: q.explanation || "",
    }));
  }
  const out = []; let subject = null; let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  const splitOpts = (line) => {
    const idx = ["A", "B", "C", "D"].map((k, i) => (i === 0 ? 0 : line.indexOf(` ${k}. `)));
    if (idx.some((x, i) => x < 0 || (i && x <= idx[i - 1]))) return null;
    return idx.map((s, i) => line.slice(s, i < 3 ? idx[i + 1] : undefined).trim().replace(/^[A-D]\.\s*/, ""));
  };
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\\([_'.#\-])/g, "$1").trim();
    if (!line) continue;
    const head = line.replace(/^#+\s*/, "").replace(/^\d+\.\s*/, "").trim();
    if (/^#+\s/.test(line) || (/^[A-Z][A-Z ()&]+$/.test(line) && !cur?.d)) {
      flush(); subject = NAMES[head.toUpperCase()] || titleCase(head); continue;
    }
    let m;
    if ((m = line.match(/^(\d+)[.)]\s+(.*)$/)) && subject && (!cur || cur.d)) {
      flush(); cur = { subject, question: m[2], a: "", b: "", c: "", d: "", correct: "", explanation: "" }; continue;
    }
    if (!cur) continue;
    if (/^A[.)]\s/.test(line) && !cur.a) {
      const o = splitOpts(line);
      if (o) [cur.a, cur.b, cur.c, cur.d] = o; else cur.a = line.replace(/^A[.)]\s*/, "");
      continue;
    }
    if ((m = line.match(/^([B-D])[.)]\s+(.*)$/)) && cur.a && !cur[m[1].toLowerCase()]) { cur[m[1].toLowerCase()] = m[2]; continue; }
    if ((m = line.match(/^Answer:\s*([A-D])/i))) { cur.correct = m[1].toUpperCase(); continue; }
    if ((m = line.match(/^Explanation:\s*(.*)$/i))) { cur.explanation = m[1]; continue; }
    if (cur.explanation) cur.explanation += " " + line;
    else if (!cur.a) cur.question += "\n" + line;
  }
  flush();
  return out;
}

$("amFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) $("amText").value = await f.text();
});

$("amPreview").addEventListener("click", () => {
  const out = $("amPreviewOut"); out.hidden = false; $("amImport").hidden = true; parsed = null;
  try {
    const qs = parseText($("amText").value);
    if (!qs.length) throw new Error("No questions found.");
    const bad = qs.map((q, i) => (!q.subject || !q.question || !q.a || !q.b || !q.c || !q.d || !["A", "B", "C", "D"].includes(String(q.correct).toUpperCase()) ? i + 1 : 0)).filter(Boolean);
    if (bad.length) throw new Error(`Incomplete question(s) at position ${bad.slice(0, 10).join(", ")} (each needs options A-D and an Answer).`);
    const counts = {};
    for (const q of qs) counts[q.subject] = (counts[q.subject] || 0) + 1;
    const note = counts["English Language"] ? "" : " Warning: no English Language questions found.";
    out.textContent = `${qs.length} questions ready: ` + Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(", ") + "." + note;
    out.className = "status"; parsed = qs; $("amImport").hidden = false;
  } catch (e) { out.textContent = e.message; out.className = "status error"; }
});

$("amImport").addEventListener("click", async () => {
  if (!parsed) return;
  $("amImport").disabled = true;
  try {
    const { data, error } = await supabase.rpc("zot_admin_mock_import", {
      p_challenge: $("amQRound").value, p_questions: parsed, p_replace: $("amReplace").checked,
    });
    if (error) throw error;
    say(`Imported ${data} questions.`, true); $("amPreviewOut").hidden = true; $("amImport").hidden = true; parsed = null;
    await load();
  } catch (e) { say(`Import failed: ${e.message}`); }
  $("amImport").disabled = false;
});

$("amLoad").addEventListener("click", async () => {
  const box = $("amBoard"); box.textContent = "Loading…";
  const { data, error } = await supabase.rpc("zot_mock_leaderboard", { p_challenge: $("amLRound").value });
  if (error) { box.textContent = error.message; return; }
  const rows = data || [];
  if (!rows.length) { box.textContent = "Nobody has submitted this round yet."; return; }
  const table = el("table", { class: "mc-table" });
  table.append(el("thead", {}, el("tr", {}, ...["#", "Student", "Track", "Score", "Time"].map((h) => el("th", { text: h })))));
  const tb = el("tbody");
  for (const x of rows) {
    tb.append(el("tr", {}, el("td", { text: String(x.rank) }),
      el("td", {}, el("strong", { text: x.full_name }), el("small", { text: `${x.course} · ${(x.subjects || []).join(", ")}` })),
      el("td", { text: x.track }), el("td", { text: `${x.score}/400` }), el("td", { text: fmtDuration(x.time_taken_seconds) })));
  }
  table.append(tb);
  box.replaceChildren(el("p", { class: "lede", text: `${rows.length} submitted` }), el("div", { class: "mc-table-wrap" }, table));
});

(async () => {
  try {
    if (!(await requireAdmin())) return;
    await load();
    msg.hidden = true; $("amBody").hidden = false;
  } catch (e) { console.error(e); say(`Could not load: ${e.message}`); }
})();
