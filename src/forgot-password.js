import { supabase } from "./supabase.js";
import "./site.js";
import "./register.css";
import { ERR_ICON } from "./pw-ui.js";

const app = document.getElementById("app");
const WA = "https://wa.me/2349128462600";

app.innerHTML = `
  <main class="auth-card">
    <span class="chip">Password help</span>
    <h1>Forgot your password?</h1>
    <p class="lede">Enter the email you registered with. We will email you a link to choose a new password.</p>

    <form id="forgotForm" novalidate>
      <label class="field-label" for="email">Email address</label>
      <input class="input" id="email" type="email" autocomplete="email" inputmode="email" required placeholder="Enter your registered email" />
      <div class="form-error" id="formError" role="alert" hidden>${ERR_ICON}<span id="formErrorText"></span></div>
      <button class="btn btn--block" id="sendBtn" type="submit">Send reset link</button>
    </form>

    <div id="sent" hidden>
      <p class="pw-intro" id="sentText"></p>
      <p class="field-hint">Nothing in your inbox after a few minutes? Check your spam or junk folder. The link can only be used once.</p>
      <div class="reg-actions">
        <button class="reg-act" id="resendBtn" type="button" disabled>Send again</button>
        <a class="reg-act alt" href="${WA}" target="_blank" rel="noopener noreferrer">WhatsApp the administrator</a>
      </div>
    </div>

    <p class="field-hint"><a href="/student-login.html">Back to sign in</a></p>
  </main>
`;

const form = document.getElementById("forgotForm");
const emailInput = document.getElementById("email");
const formError = document.getElementById("formError");
const formErrorText = document.getElementById("formErrorText");
const sendBtn = document.getElementById("sendBtn");
const sent = document.getElementById("sent");
const resendBtn = document.getElementById("resendBtn");
let cooldown = null;

function showError(text) {
  formErrorText.textContent = text;
  formError.hidden = false;
  emailInput.setAttribute("aria-invalid", "true");
  formError.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearError() {
  formError.hidden = true;
  emailInput.removeAttribute("aria-invalid");
}

function friendly(error) {
  const m = String(error?.message || "");
  if (error?.status === 429 || /rate limit|too many|security purposes|seconds/i.test(m))
    return "Too many requests. Please wait a few minutes, then try again.";
  if (/failed to fetch|network|load failed/i.test(m))
    return "We couldn't reach the server. Check your internet connection and try again.";
  return "We couldn't send the email right now. Please try again in a moment, or WhatsApp the administrator for help.";
}

function startCooldown() {
  let left = 60;
  resendBtn.disabled = true;
  clearInterval(cooldown);
  const tick = () => {
    resendBtn.textContent = left > 0 ? `Send again in ${left}s` : "Send again";
    if (left <= 0) {
      resendBtn.disabled = false;
      clearInterval(cooldown);
    }
    left -= 1;
  };
  cooldown = setInterval(tick, 1000);
  tick();
}

async function send(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password.html`,
  });
  if (error) throw error;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  const email = emailInput.value.trim().toLowerCase();
  if (!email) return showError("Please enter your email address.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return showError("That doesn't look like a valid email address. Check it and try again.");

  sendBtn.disabled = true;
  sendBtn.textContent = "Sending…";
  try {
    await send(email);
    // Same message whether or not the email has an account, so nobody can
    // use this page to find out who is registered.
    document.getElementById("sentText").textContent =
      `If an account exists for ${email}, we have sent a link to it. Open the email and tap the link to choose a new password.`;
    form.hidden = true;
    sent.hidden = false;
    startCooldown();
    resendBtn.onclick = async () => {
      resendBtn.disabled = true;
      try {
        await send(email);
        startCooldown();
      } catch (e) {
        document.getElementById("sentText").textContent = friendly(e);
        resendBtn.disabled = false;
      }
    };
  } catch (error) {
    console.error("ZOT forgot-password error:", error);
    showError(friendly(error));
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "Send reset link";
  }
});

emailInput.addEventListener("input", clearError);
