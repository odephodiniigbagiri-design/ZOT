import { supabase } from "./supabase.js";
import "./site.js";
import "./affiliate.css";
import { normalizeWhatsapp } from "./phone.js";

const DASHBOARD = "/affiliate-dashboard.html";
const app = document.getElementById("app");

app.innerHTML = `
  <main class="auth-card auth-card--wide aff">
    <span class="chip">Earn with Zenith</span>
    <h1>Earn ₦1,000 for every student you refer</h1>
    <p class="lede">
      Create a free affiliate account, share your personal link, and get paid
      when the students you bring join Zenith Online Tutorials.
    </p>

    <ol class="aff-steps">
      <li><b>Sign up</b><span>Fill in the short form below.</span></li>
      <li><b>Share your link</b><span>Send it to friends, classmates and groups.</span></li>
      <li><b>Get paid</b><span>₦1,000 per student. Withdraw from ₦3,000.</span></li>
    </ol>

    <div class="aff-tabs" role="tablist" aria-label="Affiliate account">
      <button type="button" role="tab" id="tabSignup" aria-selected="true" aria-controls="paneSignup">Create account</button>
      <button type="button" role="tab" id="tabLogin" aria-selected="false" aria-controls="paneLogin">Log in</button>
    </div>

    <section id="paneSignup" role="tabpanel" aria-labelledby="tabSignup">
      <form id="signupForm" novalidate>
        <label class="field-label" for="suName">Full name</label>
        <input class="input" id="suName" autocomplete="name" maxlength="120" required />

        <label class="field-label" for="suPhone">WhatsApp number</label>
        <input class="input" id="suPhone" type="tel" autocomplete="tel" maxlength="20" placeholder="e.g. 08012345678" required />

        <label class="field-label" for="suEmail">Email address</label>
        <input class="input" id="suEmail" type="email" autocomplete="email" maxlength="254" required />

        <label class="field-label" for="suPass">Password (at least 8 characters)</label>
        <input class="input" id="suPass" type="password" autocomplete="new-password" minlength="8" required />

        <label class="aff-show"><input type="checkbox" data-show="suPass" /> Show password</label>

        <button class="btn btn--block" id="suBtn" type="submit">Create my affiliate account</button>
      </form>
    </section>

    <section id="paneLogin" role="tabpanel" aria-labelledby="tabLogin" hidden>
      <form id="loginForm" novalidate>
        <label class="field-label" for="liEmail">Email address</label>
        <input class="input" id="liEmail" type="email" autocomplete="email" required />

        <label class="field-label" for="liPass">Password</label>
        <input class="input" id="liPass" type="password" autocomplete="current-password" required />

        <label class="aff-show"><input type="checkbox" data-show="liPass" /> Show password</label>

        <button class="btn btn--block" id="liBtn" type="submit">Log in</button>
        <p class="aff-forgot"><button type="button" id="forgotBtn" class="aff-link">Forgot your password?</button></p>
      </form>
    </section>

    <section id="paneReset" hidden>
      <h2>Choose a new password</h2>
      <form id="resetForm" novalidate>
        <label class="field-label" for="rsPass">New password (at least 8 characters)</label>
        <input class="input" id="rsPass" type="password" autocomplete="new-password" minlength="8" required />
        <button class="btn btn--block" id="rsBtn" type="submit">Save new password</button>
      </form>
    </section>

    <p id="affMsg" class="status" role="status" aria-live="polite"></p>
    <div id="affExtra"></div>
  </main>
`;

const $ = (id) => document.getElementById(id);
const msg = $("affMsg");
const panes = { signup: $("paneSignup"), login: $("paneLogin"), reset: $("paneReset") };
const tabs = { signup: $("tabSignup"), login: $("tabLogin") };

function say(text, kind = "") {
  msg.textContent = text;
  msg.className = "status" + (kind ? " status--" + kind : "");
}

function showPane(name) {
  for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
  for (const [k, el] of Object.entries(tabs)) el.setAttribute("aria-selected", String(k === name));
  document.querySelector(".aff-tabs").hidden = name === "reset";
  say("");
}

tabs.signup.addEventListener("click", () => showPane("signup"));
tabs.login.addEventListener("click", () => showPane("login"));

document.querySelectorAll("[data-show]").forEach((box) =>
  box.addEventListener("change", () => {
    $(box.dataset.show).type = box.checked ? "text" : "password";
  })
);

function busy(button, on, label) {
  button.disabled = on;
  button.textContent = on ? "Please wait…" : label;
}

const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** Signed in: make sure this account is an affiliate, then open the dashboard. */
async function routeSignedIn() {
  say("Opening your dashboard…");
  const { data, error } = await supabase.rpc("zot_affiliate_ensure");
  if (error) {
    console.error("zot_affiliate_ensure failed:", error);
    say("We couldn't open your affiliate account right now. Please try again.", "error");
    return;
  }
  if (!data) {
    const { data: s } = await supabase.auth.getSession();
    say(`You're signed in as ${s.session?.user?.email || "another account"}, which isn't an affiliate account. ` +
        "Sign out to create or use an affiliate account.", "error");
    const out = document.createElement("button");
    out.className = "btn btn--alt";
    out.type = "button";
    out.textContent = "Sign out";
    out.addEventListener("click", async () => {
      await supabase.auth.signOut();
      location.reload();
    });
    $("affExtra").replaceChildren(out);
    return;
  }
  location.replace(DASHBOARD);
}

// ----------------------------------------------------------------- sign up
$("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("suName").value.trim();
  const phone = normalizeWhatsapp($("suPhone").value);
  const email = $("suEmail").value.trim().toLowerCase();
  const password = $("suPass").value;

  if (name.length < 2) return say("Please enter your full name.", "error");
  if (!/^\d{10,15}$/.test(phone)) return say("Enter a valid WhatsApp number, e.g. 08012345678.", "error");
  if (!emailOk(email)) return say("Enter a valid email address.", "error");
  if (password.length < 8) return say("Your password must be at least 8 characters.", "error");

  const btn = $("suBtn");
  busy(btn, true);
  say("");
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { affiliate: true, full_name: name, phone },
        emailRedirectTo: `${location.origin}/affiliate.html`,
      },
    });
    if (error) throw error;

    // An address that already has an account comes back with no identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      $("liEmail").value = email;
      showPane("login");
      say("This email already has an account. Log in instead.", "error");
      return;
    }
    if (data.session) return await routeSignedIn();

    $("signupForm").replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "aff-done",
        innerHTML: "<h2>Check your email ✉️</h2>",
      }),
    );
    const p = document.createElement("p");
    p.textContent = `We sent a confirmation link to ${email}. Click it, then come back here and log in. ` +
      "If you don't see it, check your spam folder.";
    $("signupForm").append(p);
  } catch (err) {
    console.error("Sign-up failed:", err);
    say(/rate limit/i.test(err.message)
      ? "Too many attempts. Please wait a few minutes and try again."
      : err.message || "Could not create your account.", "error");
  } finally {
    if (btn.isConnected) busy(btn, false, "Create my affiliate account");
  }
});

// ------------------------------------------------------------------- log in
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("liEmail").value.trim().toLowerCase();
  const password = $("liPass").value;
  if (!emailOk(email) || !password) return say("Enter your email and password.", "error");

  const btn = $("liBtn");
  busy(btn, true);
  say("");
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (/email not confirmed/i.test(error.message)) {
        return say("Please confirm your email first. Check your inbox (and spam folder) for our link.", "error");
      }
      if (/invalid login/i.test(error.message)) return say("Wrong email or password.", "error");
      throw error;
    }
    await routeSignedIn();
  } catch (err) {
    console.error("Login failed:", err);
    say(err.message || "Could not log you in.", "error");
  } finally {
    busy(btn, false, "Log in");
  }
});

$("forgotBtn").addEventListener("click", async () => {
  const email = $("liEmail").value.trim().toLowerCase();
  if (!emailOk(email)) return say("Type your email address above first, then tap “Forgot your password?”.", "error");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}/affiliate.html`,
  });
  if (error) {
    console.error("Reset request failed:", error);
    return say(/rate limit/i.test(error.message)
      ? "Too many requests. Please wait a few minutes and try again."
      : "We couldn't send the reset link. Please try again.", "error");
  }
  say("If that email has an account, a password reset link is on its way. Check your inbox.", "ok");
});

// ----------------------------------------------------------- password reset
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") showPane("reset");
});

$("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("rsPass").value;
  if (password.length < 8) return say("Your password must be at least 8 characters.", "error");
  const btn = $("rsBtn");
  busy(btn, true);
  const { error } = await supabase.auth.updateUser({ password });
  busy(btn, false, "Save new password");
  if (error) {
    console.error("Password update failed:", error);
    return say(error.message || "Could not update your password.", "error");
  }
  say("Password updated.", "ok");
  await routeSignedIn();
});

// "Affiliate login" links point at /affiliate.html#login, also on back/forward.
window.addEventListener("hashchange", () => {
  if (location.hash === "#login") showPane("login");
  else if (location.hash === "#signup") showPane("signup");
});

// --------------------------------------------------------------------- start
(async function init() {
  if (location.hash === "#login") showPane("login");
  if (/type=recovery/.test(location.hash)) {
    showPane("reset");
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) await routeSignedIn();
})();
