import { supabase } from "./supabase.js";
import "./site.js";
import "./affiliate.css";

const LOGIN = "/affiliate.html";
const app = document.getElementById("app");

const naira = (kobo) =>
  "₦" + (Number(kobo || 0) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });
const when = (iso) =>
  new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

app.innerHTML = `
  <main class="auth-card auth-card--wide aff" id="dash">
    <p class="status" id="dMsg" role="status" aria-live="polite">Loading your dashboard…</p>
  </main>
`;
const dash = document.getElementById("dash");

function statCard(label, value, note) {
  const c = el("div", { class: "aff-stat" }, el("div", { class: "aff-stat__label", text: label }),
    el("div", { class: "aff-stat__num", text: value }));
  if (note) c.append(el("div", { class: "aff-stat__note", text: note }));
  return c;
}

function pill(status) {
  return el("span", { class: "aff-pill aff-pill--" + status, text: status });
}

function table(headers, rows, empty) {
  if (!rows.length) return el("p", { class: "lede", text: empty });
  const thead = el("thead", {}, el("tr", {}, ...headers.map((h) => el("th", { text: h }))));
  const tbody = el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((c) => {
    const td = el("td");
    td.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return td;
  }))));
  return el("div", { class: "aff-table" }, el("table", {}, thead, tbody));
}

let flash = null; // message shown after an action, survives the re-render
let dirty = false; // true once the withdrawal form has been typed in (don't refresh over it)

async function load() {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return location.replace(LOGIN);

  const ensured = await supabase.rpc("zot_affiliate_ensure");
  if (ensured.error || !ensured.data) {
    if (ensured.error) console.error(ensured.error);
    return location.replace(LOGIN);
  }
  const { data, error } = await supabase.rpc("zot_affiliate_dashboard");
  if (error || !data) {
    console.error("Dashboard failed:", error);
    dash.replaceChildren(el("p", { class: "status status--error",
      text: "We couldn't load your dashboard. Please refresh the page." }));
    return;
  }
  render(data);
}

function render(d) {
  dirty = false;
  const { affiliate: a, stats: s, settings } = d;
  const link = `${location.origin}/?ref=${a.code}`;
  const firstName = (a.full_name || "").split(" ")[0] || "there";
  const min = settings.min_withdrawal_kobo;

  // ---- header
  const out = el("button", { class: "btn btn--alt aff-out", type: "button", text: "Sign out" });
  out.addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.replace(LOGIN);
  });
  const head = el("div", { class: "aff-head" },
    el("div", {}, el("span", { class: "chip", text: "Affiliate dashboard" }),
      el("h1", { text: `Hi, ${firstName}` }),
      el("p", { class: "lede",
        text: `You earn ${naira(settings.commission_kobo)} each time a student you refer pays and is confirmed.` })),
    out);

  // ---- referral link
  const input = el("input", { class: "input", id: "refLink", readonly: "", value: link, "aria-label": "Your referral link" });
  const copy = el("button", { class: "btn", type: "button", text: "Copy link" });
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); }
    catch { input.select(); document.execCommand("copy"); }
    copy.textContent = "Copied ✓";
    setTimeout(() => (copy.textContent = "Copy link"), 2000);
  });
  const share = el("a", {
    class: "btn aff-wa", target: "_blank", rel: "noopener", text: "Share on WhatsApp",
    href: "https://wa.me/?text=" + encodeURIComponent(
      "Preparing for JAMB? Join Zenith Online Tutorials 📚\n" + link),
  });
  const linkBox = el("section", { class: "aff-box" },
    el("h2", { text: "Your personal link" }),
    el("p", { class: "lede", text: `Anyone who pays after opening this link counts as your referral. Your code: ${a.code}` }),
    el("div", { class: "aff-linkrow" }, input, copy, share));

  // ---- stats
  const stats = el("div", { class: "aff-stats" },
    statCard("Students referred", String(s.referred),
      s.waiting > 0 ? `${s.waiting} waiting for payment confirmation` : ""),
    statCard("Total earned", naira(s.earned_kobo)),
    statCard("Paid out", naira(s.paid_kobo)),
    statCard("Balance", naira(s.balance_kobo),
      s.pending_withdrawal_kobo > 0 ? `${naira(s.pending_withdrawal_kobo)} in a pending withdrawal` : ""));

  // ---- withdrawal
  const wbox = el("section", { class: "aff-box" }, el("h2", { text: "Withdraw your earnings" }));
  if (s.available_kobo < min) {
    wbox.append(el("p", { class: "lede",
      text: `The minimum withdrawal is ${naira(min)}. You have ${naira(s.available_kobo)} available, ` +
            `so you need ${naira(min - s.available_kobo)} more.` }));
  } else {
    wbox.append(el("p", { class: "lede",
      text: `You can withdraw up to ${naira(s.available_kobo)} (minimum ${naira(min)}). The admin pays you by bank transfer.` }));
    wbox.append(withdrawForm(s.available_kobo, min));
  }

  // ---- history tables
  const refs = el("section", { class: "aff-box" }, el("h2", { text: "Your referrals" }),
    table(["Student", "Date", "Earned"],
      (d.referrals || []).map((r) => [r.student, when(r.created_at), naira(r.commission_kobo)]),
      "No confirmed referrals yet. Share your link to get started."));
  const wds = el("section", { class: "aff-box" }, el("h2", { text: "Your withdrawals" }),
    table(["Requested", "Amount", "Bank", "Status", "Note"],
      (d.withdrawals || []).map((w) => [when(w.requested_at), naira(w.amount_kobo),
        `${w.bank_name} ••••${w.account_last4}`, pill(w.status), w.admin_note || ""]),
      "No withdrawals yet."));

  const parts = [head];
  if (flash) { parts.push(el("p", { class: "status status--" + flash.kind, role: "status", text: flash.text })); flash = null; }
  parts.push(linkBox, stats, wbox, refs, wds);
  dash.replaceChildren(...parts);
}

function withdrawForm(available, min) {
  const f = (label, id, attrs) => el("div", { class: "aff-field" },
    el("label", { class: "field-label", for: id, text: label }), el("input", { class: "input", id, required: "", ...attrs }));
  const msg = el("p", { class: "status", role: "status", "aria-live": "polite" });
  const btn = el("button", { class: "btn btn--block", type: "submit", text: "Request withdrawal" });
  const form = el("form", { novalidate: "" },
    f("Amount (₦)", "wAmount", { type: "number", inputmode: "decimal", min: String(min / 100), max: String(available / 100),
      step: "1", value: String(available / 100) }),
    f("Bank name", "wBank", { maxlength: "60", autocomplete: "off", placeholder: "e.g. PalmPay, GTBank, Opay" }),
    f("Account number", "wAcct", { inputmode: "numeric", maxlength: "10", autocomplete: "off", placeholder: "10 digits" }),
    f("Account name", "wName", { maxlength: "120", autocomplete: "off" }),
    btn, msg);

  form.addEventListener("input", () => { dirty = true; });
  const say = (t, kind = "error") => { msg.textContent = t; msg.className = "status status--" + kind; };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const naira_ = parseFloat(form.querySelector("#wAmount").value);
    const kobo = Math.round(naira_ * 100);
    const bank = form.querySelector("#wBank").value.trim();
    const acct = form.querySelector("#wAcct").value.replace(/\s/g, "");
    const name = form.querySelector("#wName").value.trim();

    if (!Number.isFinite(kobo) || kobo < min) return say(`The minimum withdrawal is ${naira(min)}.`);
    if (kobo > available) return say(`You can withdraw up to ${naira(available)} right now.`);
    if (bank.length < 2) return say("Enter the name of your bank.");
    if (!/^\d{10}$/.test(acct)) return say("Enter a valid 10-digit account number.");
    if (name.length < 2) return say("Enter the name on the account.");
    if (!window.confirm(`Request ${naira(kobo)} to ${bank}, account ${acct} (${name})?\nCheck the details carefully; the admin will pay exactly what you entered.`)) return;

    btn.disabled = true; btn.textContent = "Sending…"; say("");
    const { error } = await supabase.rpc("zot_affiliate_request_withdrawal", {
      p_amount_kobo: kobo, p_bank_name: bank, p_account_number: acct, p_account_name: name,
    });
    if (error) {
      console.error("Withdrawal failed:", error);
      btn.disabled = false; btn.textContent = "Request withdrawal";
      return say(error.message || "Could not send your request. Please try again.");
    }
    flash = { kind: "ok", text: `Withdrawal of ${naira(kobo)} requested. The admin will pay it to your account and it will show as paid here.` };
    await load();
  });
  return form;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !dirty) load();
});

load();
