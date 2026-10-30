import { supabase } from "./supabase.js";

const BUCKET = "payment-receipts";
const POLL_MS = 30000;

const host = document.getElementById("receiptsSection");
const pendingList = document.getElementById("pendingList");
const verifiedList = document.getElementById("verifiedList");
const badge = document.getElementById("pendingBadge");
const statusBox = document.getElementById("receiptsStatus");
const countCard = document.getElementById("paymentCount");

let tutorials = new Map();
let packages = new Map();
let affiliates = new Map();
let busy = false;

const naira = (kobo) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(Number(kobo) / 100);

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

function referredBy(row) {
  const a = affiliates.get(String(row.affiliate_code).toUpperCase());
  return a
    ? `Referred by ${a.full_name} (${a.code})`
    : `Referral code ${row.affiliate_code} (no matching affiliate)`;
}

function planOf(row) {
  const tut = tutorials.get(String(row.tutorial_id));
  const pkg = packages.get(String(row.package_id));
  return {
    tutorial: tut ? tut.name : "Unknown tutorial",
    pkg: pkg ? pkg.name : "Unknown package",
    price: pkg ? naira(pkg.price_kobo) : "—",
  };
}

export function whatsappLink(row) {
  const digits = String(row.whatsapp_number).replace(/\D/g, "");
  const plan = planOf(row);
  const expires = row.invitation_expires_at
    ? ` The link expires on ${new Date( row.invitation_expires_at ).toLocaleString()}.`
    : "";
  const text =
    `Hello ${row.full_name}, your payment for ${plan.tutorial} (${plan.pkg}) has been confirmed ✅\n\n` +
    `Complete your registration here:\n${row.registration_url}\n\n` +
    `Open the link, confirm your verified payment, and create your password. No email confirmation is required.${expires}\n\n— Zenith Tutorials`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

async function errorMessage(error, data) {
  let m = data?.error || "";
  if (!m) {
    try {
      m = (await error.context?.json())?.error || "";
    } catch {
      /* no JSON body */
    }
  }
  return m || error.message || "Something went wrong.";
}

async function viewReceipt(row, button) {
  const tab = window.open("", "_blank"); // open synchronously so popup blockers allow it
  button.disabled = true;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.receipt_path, 300);
    if (error) throw error;
    if (tab) {
      tab.opener = null;
      tab.location.href = data.signedUrl;
    } else window.location.href = data.signedUrl;
  } catch (err) {
    if (tab) tab.close();
    console.error("Receipt link failed:", err);
    say(
      "Could not open the receipt: " + (err.message || "unknown error"),
      "error"
    );
  } finally {
    button.disabled = false;
  }
}

function linkBox(row) {
  const url = row.registration_url;
  const copy = el("button", {
    type: "button",
    class: "secondary",
    text: "Copy link",
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = "Copied!";
    } catch {
      say("Copy failed. Use Send to WhatsApp instead.", "error");
    }
  });
  const send = el("a", {
    class: "wa-btn",
    href: whatsappLink(row),
    target: "_blank",
    rel: "noopener",
    text: "Send to WhatsApp",
  });
  return el("div", { class: "actions" }, send, copy);
}

async function verify(row, button) {
  const plan = planOf(row);
  if (
    !window.confirm(
      `Have you checked your bank account and confirmed that ${plan.price} was received from ${row.full_name}?`
    )
  )
    return;

  busy = true;
  button.disabled = true;
  button.textContent = "Creating link…";
  say("Creating the registration link…");
  try {
    const { data, error } = await supabase.functions.invoke(
      "create-registration-invitation",
      {
        body: {
          email: row.email,
          submission_id: row.id,
          tutorial_id: row.tutorial_id,
          package_id: row.package_id,
          payment_confirmed: true,
        },
      }
    );
    if (error) throw new Error(await errorMessage(error, data));
    if (!data?.success || !data?.registration_url)
      throw new Error(data?.error || "No registration link was returned.");

    // The Edge Function atomically marks this exact receipt verified and
    // stores the generated invitation URL after validating the admin.
    say(`Verified. Send the link to ${row.full_name} on WhatsApp.`, "success");
  } catch (err) {
    console.error("Verification failed:", err);
    say("Could not verify: " + err.message, "error");
  } finally {
    busy = false;
  }
  await load(true);
}

async function reject(row, button) {
  const reason = window.prompt(
    `Reject ${row.full_name}'s receipt? Optionally say why (kept for your records):`,
    ""
  );
  if (reason === null) return;
  busy = true;
  button.disabled = true;
  const { error } = await supabase
    .from("payment_submissions")
    .update({ status: "rejected", admin_note: reason.trim() || null })
    .eq("id", row.id)
    .eq("status", "pending");
  busy = false;
  if (error) {
    say("Could not reject: " + error.message, "error");
    button.disabled = false;
    return;
  }
  say("Receipt rejected.", "success");
  await load(true);
}

function card(row) {
  const plan = planOf(row);
  const pending = row.status === "pending";

  const receiptBtn = el("button", {
    type: "button",
    class: "secondary",
    text: "View receipt",
  });
  receiptBtn.addEventListener("click", () => viewReceipt(row, receiptBtn));

  const wa = String(row.whatsapp_number).replace(/\D/g, "");
  const head = el(
    "div",
    { class: "rc-head" },
    el("strong", { text: row.full_name }),
    el("span", {
      class: "student-sub",
      text: new Date(row.created_at).toLocaleString(),
    })
  );

  const meta = el(
    "div",
    { class: "rc-meta" },
    el("div", { text: `${plan.tutorial} · ${plan.pkg} · ${plan.price}` }),
    el("div", {
      class: "student-sub",
      text: `${row.email} · WhatsApp +${wa} · Data +${ row.data_bundle_number || "not supplied" } · Telegram +${row.telegram_number || "not supplied"}`,
    }),
    ...(row.affiliate_code
      ? [el("div", { class: "student-sub", text: referredBy(row) })]
      : [])
  );

  const actions = el("div", { class: "actions" });
  if (pending) {
    const ok = el("button", {
      type: "button",
      class: "primary",
      text: "Verified ✓",
    });
    ok.addEventListener("click", () => verify(row, ok));
    const no = el("button", {
      type: "button",
      class: "danger",
      text: "Reject",
    });
    no.addEventListener("click", () => reject(row, no));
    actions.append(ok, receiptBtn, no);
    return el("article", { class: "rcpt-card-admin" }, head, meta, actions);
  }
  actions.append(receiptBtn);
  const exp = row.invitation_expires_at
    ? el("div", {
        class: "student-sub",
        text: `Link expires ${new Date( row.invitation_expires_at ).toLocaleString()}`,
      })
    : null;
  return el(
    "article",
    { class: "rcpt-card-admin verified" },
    head,
    meta,
    ...(exp ? [exp] : []),
    linkBox(row),
    actions
  );
}

function fill(list, rows, emptyText) {
  list.replaceChildren(
    ...(rows.length
      ? rows.map(card)
      : [el("p", { class: "student-sub", text: emptyText })])
  );
}

export async function load(keepMessage = false) {
  const [t, p, a, s] = await Promise.all([
    supabase.from("tutorials").select("id, name"),
    supabase.from("tutorial_packages").select("id, name, price_kobo"),
    supabase.from("affiliates").select("code, full_name"), // ignored if affiliates.sql isn't installed yet
    supabase
      .from("payment_submissions")
      .select("*")
      .in("status", ["pending", "verified"])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (s.error) {
    console.error("Submissions error:", s.error);
    say(
      "Could not load submitted receipts: " +
        s.error.message +
        " (Has supabase/payment-submissions.sql been run?)",
      "error"
    );
    return;
  }
  tutorials = new Map((t.data || []).map((x) => [String(x.id), x]));
  packages = new Map((p.data || []).map((x) => [String(x.id), x]));
  affiliates = new Map(
    (a.data || []).map((x) => [String(x.code).toUpperCase(), x])
  );

  const rows = s.data || [];
  const pending = rows.filter((r) => r.status === "pending").reverse(); // oldest first
  const verified = rows
    .filter((r) => r.status === "verified")
    .sort((a, b) => new Date(b.verified_at || 0) - new Date(a.verified_at || 0))
    .slice(0, 15);

  badge.textContent = String(pending.length);
  if (countCard) countCard.textContent = String(pending.length);
  fill(
    pendingList,
    pending,
    "Nothing waiting. New receipts appear here automatically."
  );
  fill(verifiedList, verified, "No verified students yet.");
  if (!busy && !keepMessage) say(`${pending.length} waiting for verification.`);
}

async function start() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) return; // the dashboard itself redirects to the admin login
  await load();
  setInterval(() => {
    if (!busy && document.visibilityState === "visible") load();
  }, POLL_MS);
}

if (host) start();
