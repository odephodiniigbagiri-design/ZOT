import { supabase } from "./supabase.js";
import "./site.js";
import "./register.css";
import { EYE, ERR_ICON, wireEyes } from "./pw-ui.js";

const app = document.getElementById("app");

// Read the link's markers now: the Supabase client clears them from the URL.
const hash = window.location.hash;
const search = window.location.search;
const linkError = /error=|error_code=/.test(hash + search);
const looksLikeRecovery = /type=recovery|access_token=|[?&]code=/.test(hash + search);

app.innerHTML = `
  <main class="auth-card">
    <span class="chip">Password help</span>
    <h1>Choose a new password</h1>
    <p class="lede" id="lede">Checking your reset link…</p>

    <form id="resetForm" novalidate hidden>
      <label class="field-label" for="password">New password</label>
      <div class="pw-wrap"><input class="input" id="password" type="password" autocomplete="new-password" aria-describedby="pwRules" required />${EYE}</div>
      <label class="field-label" for="confirmPassword">Confirm new password</label>
      <div class="pw-wrap"><input class="input" id="confirmPassword" type="password" autocomplete="new-password" aria-describedby="pwRules" required />${EYE}</div>
      <ul class="pw-rules" id="pwRules" aria-live="polite">
        <li id="ruleLen">At least 8 characters</li>
        <li id="ruleMatch">Both passwords match</li>
      </ul>
      <p class="field-hint">Tip: mix letters and numbers, and avoid your name or phone number.</p>
      <div class="form-error" id="formError" role="alert" hidden>${ERR_ICON}<span id="formErrorText"></span></div>
      <button class="btn btn--block" id="saveBtn" type="submit">Save new password</button>
    </form>

    <div id="problem" hidden>
      <div class="reg-actions">
        <a class="reg-act" href="/forgot-password.html">Get a new link</a>
        <a class="reg-act alt" href="/student-login.html">Back to sign in</a>
      </div>
    </div>
  </main>
`;

const lede = document.getElementById("lede");
const form = document.getElementById("resetForm");
const problem = document.getElementById("problem");
const pw = document.getElementById("password");
const pw2 = document.getElementById("confirmPassword");
const formError = document.getElementById("formError");
const formErrorText = document.getElementById("formErrorText");
const ruleLen = document.getElementById("ruleLen");
const ruleMatch = document.getElementById("ruleMatch");
const saveBtn = document.getElementById("saveBtn");
wireEyes(form);

let state = "checking";

function showForm() {
  if (state !== "checking") return;
  state = "ready";
  lede.textContent = "Type a new password you will remember, then confirm it.";
  form.hidden = false;
  pw.focus();
}

function showInvalid(text) {
  if (state !== "checking") return;
  state = "invalid";
  lede.textContent =
    text ||
    "This reset link is not valid. It may have expired or already been used. Request a new one and open the newest email.";
  problem.hidden = false;
}

function updateRules() {
  ruleLen.dataset.ok = pw.value ? String(pw.value.length >= 8) : "";
  ruleMatch.dataset.ok = pw2.value ? String(pw.value === pw2.value) : "";
  clearError();
}

function clearError() {
  formError.hidden = true;
  pw.removeAttribute("aria-invalid");
  pw2.removeAttribute("aria-invalid");
}

function showError(text, field) {
  formErrorText.textContent = text;
  formError.hidden = false;
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus({ preventScroll: true });
  }
  formError.scrollIntoView({ behavior: "smooth", block: "center" });
}

function friendly(error) {
  const m = String(error?.message || "");
  if (/different from the old password|same as the old/i.test(m))
    return { text: "Your new password must be different from your old one. Please choose another.", field: pw };
  if (/weak|easy to guess|pwned|compromised/i.test(m))
    return { text: "That password is too easy to guess. Try a longer one that mixes letters and numbers.", field: pw };
  if (/at least \d+ char|too short/i.test(m))
    return { text: "Your password must contain at least 8 characters.", field: pw };
  if (/session|jwt|expired|not authenticated|auth session missing/i.test(m))
    return { text: "Your reset link has expired. Please request a new one.", field: null };
  if (/failed to fetch|network|load failed/i.test(m))
    return { text: "We couldn't reach the server. Check your internet connection and try again.", field: null };
  return { text: m || "We couldn't save your new password. Please try again.", field: null };
}

pw.addEventListener("input", updateRules);
pw2.addEventListener("input", updateRules);

supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") showForm();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  const a = pw.value;
  const b = pw2.value;
  if (!a) return showError("Please enter a new password.", pw);
  if (a.length < 8)
    return showError(`Your password is too short. It has ${a.length} character${a.length === 1 ? "" : "s"}, and it needs at least 8.`, pw);
  if (!b) return showError("Please type your new password again in the Confirm box.", pw2);
  if (a !== b)
    return showError("The two passwords do not match. Check both boxes (tap the eye icon to see what you typed) and try again.", pw2);

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    const { error } = await supabase.auth.updateUser({ password: a });
    if (error) throw error;
    await supabase.auth.signOut();
    form.hidden = true;
    lede.textContent = "Your password has been changed. Taking you to sign in…";
    setTimeout(() => window.location.replace("/student-login.html?reset=true"), 1500);
  } catch (error) {
    console.error("ZOT reset-password error:", error);
    const f = friendly(error);
    showError(f.text, f.field);
    saveBtn.disabled = false;
    saveBtn.textContent = "Save new password";
  }
});

// Decide what to show once the client has had a moment to read the link.
if (linkError) {
  showInvalid("This reset link has expired or was already used. Request a new one and open the newest email.");
} else {
  setTimeout(async () => {
    if (state !== "checking") return;
    const { data } = await supabase.auth.getSession();
    if (looksLikeRecovery && data?.session) showForm();
    else showInvalid();
  }, 2500);
}
