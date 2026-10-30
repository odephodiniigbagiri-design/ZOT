import { supabase } from "./supabase.js";

const POLL_MS = 30000;

const host = document.getElementById("affiliatesSection");
const pendingList = document.getElementById("wdPendingList");
const paidList = document.getElementById("wdPaidList");
const affiliateTable = document.getElementById("affiliateTable");
const badge = document.getElementById("wdBadge");
const statusBox = document.getElementById("affStatus");

let busy = false;

const naira = (kobo) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 })
    .format(Number(kobo || 0) / 100);

function say(text, kind = "") {
  statusBox.textContent = text;
  statusBox.className = "status" + (kind ? " " + kind : "");
}

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

const digits = (v) => String(v || "").replace(/\D/g, "");

async function resolve(w, aff, status, button) {
  const who = aff ? aff.full_name : "this affiliate";
  let note = "";
  if (status === "paid") {
    if (!window.confirm(
      `Have you transferred ${naira(w.amount_kobo)} to ${who}?\n\n` +
      `${w.bank_name} · ${w.account_number} · ${w.account_name}\n\n` +
      "Click OK only after the transfer is complete."
    )) return;
    const ref = window.prompt("Payment reference or note (optional):", "");
    if (ref === null) return;
    note = ref;
  } else {
    const why = window.prompt(
      `Reject ${who}'s withdrawal of ${naira(w.amount_kobo)}? The money goes back to their balance.\n\nReason (optional):`, "");
    if (why === null) return;
    note = why;
  }

  busy = true;
  button.disabled = true;
  const { error } = await supabase.rpc("zot_admin_resolve_withdrawal", {
    p_id: w.id, p_status: status, p_note: note.trim() || null,
  });
  busy = false;
  if (error) {
    console.error("Resolve failed:", error);
    say("Could not update the request: " + error.message, "error");
    button.disabled = false;
    return;
  }
  say(status === "paid" ? `Marked as paid: ${naira(w.amount_kobo)} to ${who}.` : "Request rejected.", "success");
  await load(true);
}

function pendingCard(w, aff) {
  const copy = el("button", { type: "button", class: "secondary", text: "Copy account number" });
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(w.account_number); copy.textContent = "Copied!"; }
    catch { say("Copy failed. Select the number manually.", "error"); }
  });
  const paid = el("button", { type: "button", class: "primary", text: "Mark as paid" });
  paid.addEventListener("click", () => resolve(w, aff, "paid", paid));
  const no = el("button", { type: "button", class: "danger", text: "Reject" });
  no.addEventListener("click", () => resolve(w, aff, "rejected", no));

  const actions = el("div", { class: "actions" }, paid, copy, no);
  if (aff && digits(aff.phone)) {
    actions.append(el("a", { class: "wa-btn", target: "_blank", rel: "noopener",
      href: `https://wa.me/${digits(aff.phone)}`, text: "Message on WhatsApp" }));
  }
  return el("article", { class: "rcpt-card-admin" },
    el("div", { class: "rc-head" },
      el("strong", { text: `${aff ? aff.full_name : "Unknown affiliate"} · ${naira(w.amount_kobo)}` }),
      el("span", { class: "student-sub", text: new Date(w.requested_at).toLocaleString() })),
    el("div", { class: "rc-meta" },
      el("div", { text: `${w.bank_name} · ${w.account_number}` }),
      el("div", { class: "student-sub", text: `Account name: ${w.account_name}` })),
    actions);
}

function paidCard(w, aff) {
  return el("article", { class: "rcpt-card-admin verified" },
    el("div", { class: "rc-head" },
      el("strong", { text: `${aff ? aff.full_name : "Unknown affiliate"} · ${naira(w.amount_kobo)}` }),
      el("span", { class: "student-sub", text: `Paid ${new Date(w.resolved_at || w.requested_at).toLocaleString()}` })),
    el("div", { class: "student-sub", text: `${w.bank_name} · ${w.account_number} · ${w.account_name}` +
      (w.admin_note ? ` · ${w.admin_note}` : "") }));
}

function fill(list, rows, build, emptyText) {
  list.replaceChildren(...(rows.length ? rows.map(build) : [el("p", { class: "student-sub", text: emptyText })]));
}

function renderAffiliates(list) {
  if (!list.length) {
    affiliateTable.replaceChildren(el("p", { class: "student-sub", text: "No affiliates have signed up yet." }));
    return;
  }
  const head = el("tr", {}, ...["Affiliate", "Code", "WhatsApp", "Referred", "Earned", "Paid out", "Balance"]
    .map((h) => el("th", { text: h })));
  const body = list.map((a) => el("tr", {},
    el("td", { text: a.full_name }), el("td", { text: a.code }),
    el("td", { text: a.phone ? "+" + digits(a.phone) : "—" }),
    el("td", { text: String(a.referred) }), el("td", { text: naira(a.earned_kobo) }),
    el("td", { text: naira(a.paid_kobo) }),
    el("td", { text: naira(Number(a.earned_kobo) - Number(a.paid_kobo)) })));
  affiliateTable.replaceChildren(el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), el("tbody", {}, ...body))));
}

export async function load(keepMessage = false) {
  const [w, ov] = await Promise.all([
    supabase.from("affiliate_withdrawals").select("*")
      .in("status", ["pending", "paid"]).order("requested_at", { ascending: false }).limit(100),
    supabase.rpc("zot_admin_affiliate_overview"),
  ]);
  if (w.error || ov.error) {
    const e = w.error || ov.error;
    console.error("Affiliate load error:", e);
    say("Could not load affiliate data: " + e.message + " (Has supabase/affiliates.sql been run?)", "error");
    return;
  }
  const affiliates = ov.data || [];
  const byId = new Map(affiliates.map((a) => [a.id, a]));
  const rows = w.data || [];
  const pending = rows.filter((r) => r.status === "pending").reverse(); // oldest first
  const paid = rows.filter((r) => r.status === "paid")
    .sort((a, b) => new Date(b.resolved_at || 0) - new Date(a.resolved_at || 0)).slice(0, 10);

  badge.textContent = String(pending.length);
  fill(pendingList, pending, (r) => pendingCard(r, byId.get(r.affiliate_id)), "No withdrawal requests waiting.");
  fill(paidList, paid, (r) => paidCard(r, byId.get(r.affiliate_id)), "Nothing paid out yet.");
  renderAffiliates(affiliates);
  if (!busy && !keepMessage) say(`${pending.length} withdrawal request${pending.length === 1 ? "" : "s"} waiting.`);
}

async function start() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) return; // the dashboard redirects to the admin login itself
  await load();
  setInterval(() => {
    if (!busy && document.visibilityState === "visible") load();
  }, POLL_MS);
}

if (host) start();
