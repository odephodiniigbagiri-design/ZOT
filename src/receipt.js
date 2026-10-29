import "./receipt.css";

const BUCKET = "payment-receipts";
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
const ADMIN_WA = "2349128462600";

/** Nigerian "0803..." -> "234803..."; keeps other international numbers. */
export function normalizeWhatsapp(raw) {
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "234" + d.slice(1);
  else if (/^[789]\d{9}$/.test(d)) d = "234" + d;
  return d;
}

const naira = (kobo) =>
  "₦" + (Number(kobo) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });

let dialog, form, msg, planSelect, submitBtn, supabase, plans = new Map();
let plansLoaded = false;
let submitted = false;

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

function field(label, id, control) {
  return el("div", { class: "rcpt-field" }, el("label", { for: id, text: label }), control);
}

function build() {
  planSelect = el("select", { id: "rcptPlan", required: "" });
  planSelect.append(el("option", { value: "", text: "Loading plans…" }));

  msg = el("p", { class: "rcpt-msg", role: "status", "aria-live": "polite" });
  submitBtn = el("button", { class: "btn red", type: "submit", text: "Send receipt to admin" });

  form = el(
    "form",
    { novalidate: "" },
    field("Full name", "rcptName",
      el("input", { id: "rcptName", type: "text", autocomplete: "name", maxlength: "120", required: "" })),
    field("WhatsApp number", "rcptWa",
      el("input", { id: "rcptWa", type: "tel", autocomplete: "tel", maxlength: "20", required: "",
        placeholder: "e.g. 08012345678" })),
    field("Email address", "rcptEmail",
      el("input", { id: "rcptEmail", type: "email", autocomplete: "email", maxlength: "254", required: "",
        placeholder: "Used to verify your registration" })),
    field("Plan you paid for", "rcptPlan", planSelect),
    field("Payment receipt (photo or PDF, max 5 MB)", "rcptFile",
      el("input", { id: "rcptFile", type: "file", accept: "image/jpeg,image/png,image/webp,application/pdf", required: "" })),
    el("div", { class: "rcpt-hp", "aria-hidden": "true" },
      el("label", { for: "rcptWeb", text: "Leave this empty" }),
      el("input", { id: "rcptWeb", type: "text", tabindex: "-1", autocomplete: "off" })),
    submitBtn,
    msg
  );

  const close = el("button", { class: "rcpt-x", type: "button", "aria-label": "Close", text: "×" });
  close.addEventListener("click", () => dialog.close());

  dialog = el(
    "dialog",
    { class: "rcpt", "aria-labelledby": "rcptTitle" },
    el("div", { class: "rcpt-card" },
      close,
      el("h2", { id: "rcptTitle", text: "Send receipt to admin" }),
      el("p", { class: "rcpt-lede",
        text: "Already paid? Fill this in and attach your receipt. Once the admin confirms the payment, your registration link is sent to your WhatsApp." }),
      form)
  );
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    if (!submitted) return;
    // After a successful send, start fresh next time the form is opened.
    dialog.remove();
    dialog = null;
    plansLoaded = false;
    submitted = false;
  });
  document.body.append(dialog);
  form.addEventListener("submit", onSubmit);
  form.addEventListener("input", () => { if (!submitBtn.disabled) say(""); });
}

function say(text, kind = "") {
  msg.textContent = text;
  msg.className = "rcpt-msg" + (kind ? " " + kind : "");
}

function fallbackNote() {
  msg.append(" Or send your receipt directly on WhatsApp: ");
  const a = el("a", { href: `https://wa.me/${ADMIN_WA}`, target: "_blank", rel: "noopener", text: "chat with admin" });
  msg.append(a, ".");
}

async function getClient() {
  if (!supabase) ({ supabase } = await import("./supabase.js"));
  return supabase;
}

async function loadPlans() {
  if (plansLoaded) return;
  try {
    const sb = await getClient();
    const [t, p] = await Promise.all([
      sb.from("tutorials").select("id, name, exam_year").eq("is_active", true),
      sb.from("tutorial_packages")
        .select("id, tutorial_id, name, access_months, price_kobo")
        .eq("is_active", true).order("price_kobo", { ascending: true }),
    ]);
    if (t.error) throw t.error;
    if (p.error) throw p.error;

    const tutorials = new Map((t.data || []).map((x) => [String(x.id), x]));
    planSelect.replaceChildren(el("option", { value: "", text: "Choose your plan" }));
    plans = new Map();
    for (const pkg of p.data || []) {
      const tut = tutorials.get(String(pkg.tutorial_id));
      if (!tut) continue;
      plans.set(String(pkg.id), { tutorial_id: String(tut.id), package_id: String(pkg.id) });
      const months = `${pkg.access_months} month${pkg.access_months === 1 ? "" : "s"}`;
      planSelect.append(el("option", {
        value: String(pkg.id),
        text: `${tut.name} · ${pkg.name} · ${naira(pkg.price_kobo)} (${months})`,
      }));
    }
    if (!plans.size) throw new Error("No active plans");
    plansLoaded = true;
  } catch (err) {
    console.error("Could not load plans:", err);
    planSelect.replaceChildren(el("option", { value: "", text: "Plans unavailable" }));
    say("We couldn't load the plans right now. Please refresh and try again.", "err");
    fallbackNote();
  }
}

async function onSubmit(e) {
  e.preventDefault();
  if (form.querySelector("#rcptWeb").value) return; // honeypot: bots fill this in

  const name = form.querySelector("#rcptName").value.trim();
  const wa = normalizeWhatsapp(form.querySelector("#rcptWa").value);
  const email = form.querySelector("#rcptEmail").value.trim().toLowerCase();
  const plan = plans.get(planSelect.value);
  const file = form.querySelector("#rcptFile").files[0];

  if (name.length < 2) return say("Please enter your full name.", "err");
  if (!/^\d{10,15}$/.test(wa)) return say("Enter a valid WhatsApp number, e.g. 08012345678.", "err");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say("Enter a valid email address.", "err");
  if (!plan) return say("Choose the plan you paid for.", "err");
  if (!file) return say("Attach your payment receipt.", "err");
  if (!TYPES[file.type]) return say("The receipt must be a JPG, PNG, WebP or PDF file.", "err");
  if (file.size > MAX_BYTES) return say("The receipt is larger than 5 MB. Please send a smaller photo.", "err");

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";
  say("Uploading your receipt…");

  try {
    const sb = await getClient();
    const id = crypto.randomUUID();
    const path = `${id}/receipt.${TYPES[file.type]}`;

    const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw up.error;

    const ins = await sb.from("payment_submissions").insert({
      id, full_name: name, email, whatsapp_number: wa,
      tutorial_id: plan.tutorial_id, package_id: plan.package_id, receipt_path: path,
    });
    if (ins.error) throw ins.error;

    submitted = true;
    form.replaceChildren(
      el("div", { class: "rcpt-done" },
        el("h3", { text: "Receipt sent ✓" }),
        el("p", { text: `The admin will confirm your payment and send your registration link to WhatsApp (+${wa}). Please keep an eye on WhatsApp.` })),
      Object.assign(el("button", { class: "btn", type: "button", text: "Close" }), {
        onclick: () => dialog.close(),
      })
    );
  } catch (err) {
    console.error("Receipt submission failed:", err);
    say("We couldn't send your receipt. Please check your connection and try again.", "err");
    fallbackNote();
    submitBtn.disabled = false;
    submitBtn.textContent = "Send receipt to admin";
  }
}

function open() {
  if (!dialog) build();
  if (!dialog.open) dialog.showModal();
  loadPlans();
}

document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-open-receipt]");
  if (!trigger) return;
  e.preventDefault();
  open();
});
