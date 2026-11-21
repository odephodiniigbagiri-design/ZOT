import { supabase } from "./supabase.js";
import "./site.js";
import "./register.css";

function formatZotId(id) {
  return `ZOT${String(id).padStart(5, "0")}`;
}

const app = document.getElementById("app");
const params = new URLSearchParams(window.location.search);
const token = params.get("token");

app.innerHTML = `
  <main class="auth-card" data-stage="verify">
    <span class="chip">Student registration</span>
    <h1>Welcome to ZOT</h1>
    <p class="lede">Your payment has been reviewed by the ZOT administrator. Verify your registration and create your password to activate your student account.</p>
    <ol class="steps" aria-label="Registration steps">
      <li>Payment verified</li><li>Create password</li><li>Dashboard</li>
    </ol>
    <div id="registrationMessage" class="status" role="status" aria-live="polite">Checking your invitation link...</div>
    <section id="studentDetails" hidden>
      <h2>Your submitted details</h2>
      <p class="student-sub">These details were retrieved from the payment receipt you submitted. Contact the administrator if anything is incorrect.</p>
      <div id="detailsSummary" class="registration-details"></div>
      <button class="btn btn--block" type="button" id="confirmVerifiedButton">Verify my registration</button>
    </section>
    <form id="registrationForm" hidden novalidate>
      <p class="pw-intro" id="pwIntro">Choose a password you will remember. You will sign in to your dashboard with your email and this password.</p>
      <label class="field-label" for="password">Create a password</label>
      <div class="pw-wrap"><input class="input" id="password" name="password" type="password" autocomplete="new-password" aria-describedby="pwRules" required /><button type="button" class="pw-eye" data-eye aria-pressed="false" aria-label="Show password"><svg class="on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="off" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg></button></div>
      <label class="field-label" for="confirmPassword">Confirm password</label>
      <div class="pw-wrap"><input class="input" id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" aria-describedby="pwRules" required /><button type="button" class="pw-eye" data-eye aria-pressed="false" aria-label="Show password"><svg class="on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="off" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg></button></div>
      <ul class="pw-rules" id="pwRules" aria-live="polite">
        <li id="ruleLen">At least 8 characters</li>
        <li id="ruleMatch">Both passwords match</li>
      </ul>
      <p class="field-hint">Tip: mix letters and numbers, and avoid your name or phone number.</p>
      <label class="field-label" for="referralCode">Referral code (optional)</label>
      <input class="input input--upper" id="referralCode" name="referralCode" type="text" autocomplete="off" maxlength="32" placeholder="Enter a friend's ZOT referral code" />
      <div class="form-error" id="formError" role="alert" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg><span id="formErrorText"></span></div>
      <button class="btn btn--block" type="submit">Verify &amp; create my account</button>
    </form>
  </main>
`;

const card = document.querySelector(".auth-card");
const message = document.getElementById("registrationMessage");
const form = document.getElementById("registrationForm");
const detailsPanel = document.getElementById("studentDetails");
const detailsSummary = document.getElementById("detailsSummary");
const confirmVerifiedButton = document.getElementById("confirmVerifiedButton");
let invitation = null;

const pw = document.getElementById("password");
const pw2 = document.getElementById("confirmPassword");
const refInput = document.getElementById("referralCode");
const formError = document.getElementById("formError");
const formErrorText = document.getElementById("formErrorText");
const ruleLen = document.getElementById("ruleLen");
const ruleMatch = document.getElementById("ruleMatch");

document.querySelectorAll("[data-eye]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
});

function updateRules() {
  const a = pw.value;
  const b = pw2.value;
  ruleLen.dataset.ok = a.length === 0 ? "" : String(a.length >= 8);
  ruleMatch.dataset.ok = b.length === 0 ? "" : String(a === b);
  pw.removeAttribute("aria-invalid");
  pw2.removeAttribute("aria-invalid");
  clearFormError();
}

function clearFormError() {
  formError.hidden = true;
  formErrorText.textContent = "";
}

function showFormError(text, field) {
  formErrorText.textContent = text;
  formError.hidden = false;
  document.querySelectorAll("#registrationForm .input").forEach((i) => i.removeAttribute("aria-invalid"));
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus({ preventScroll: true });
  }
  formError.scrollIntoView({ behavior: "smooth", block: "center" });
}

function friendlyError(raw) {
  const m = String(raw || "");
  if (/different from the old password/i.test(m))
    return { text: "This password is the same as the one already set on your account. Please choose a different password.", field: pw };
  if (/weak|easy to guess|pwned|compromised/i.test(m))
    return { text: "That password is too easy to guess. Try a longer one that mixes letters and numbers.", field: pw };
  if (/at least \d+ char|too short/i.test(m))
    return { text: "Your password must contain at least 8 characters.", field: pw };
  if (/referral/i.test(m))
    return { text: m, field: refInput };
  if (/rate limit|too many/i.test(m))
    return { text: "Too many attempts. Please wait a minute, then try again.", field: null };
  if (/failed to fetch|network|load failed|timeout/i.test(m))
    return { text: "We couldn't reach the server. Check your internet connection and try again.", field: null };
  return { text: m || "Registration failed. Please try again or contact the administrator.", field: null };
}

pw.addEventListener("input", updateRules);
pw2.addEventListener("input", updateRules);
refInput.addEventListener("input", clearFormError);

function showDetails(data) {
  const rows = [
    ["Full name", data.full_name],
    ["Email", data.email],
    ["WhatsApp number", data.whatsapp_number],
    ["Data bundle number", data.data_bundle_number],
    ["Telegram number", data.telegram_number],
    ["Tutorial", data.tutorial_name],
    ["Package", data.package_name],
  ].filter(([, value]) => value);
  detailsSummary.replaceChildren(
    ...rows.map(([label, value]) => {
      const wrapper = document.createElement("div");
      wrapper.className = "registration-detail-row";
      const strong = document.createElement("strong");
      strong.textContent = label;
      const span = document.createElement("span");
      span.textContent = String(value);
      wrapper.append(strong, span);
      return wrapper;
    })
  );
}

if (!token) {
  message.textContent =
    "No invitation token was found. Please open the registration link sent by the ZOT administrator.";
} else {
  try {
    const { data, error } = await supabase.functions.invoke(
      "verify-registration-invitation",
      { body: { token } }
    );
    if (error || !data?.valid)
      throw new Error(
        data?.error || error?.message || "Invitation verification failed."
      );
    invitation = data;

    // A previous successful registration should not be repeated in this browser.
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUser = sessionData?.session?.user;
    if (
      currentUser &&
      currentUser.email?.toLowerCase() !== String(data.email).toLowerCase()
    ) {
      await supabase.auth.signOut({ scope: "local" });
    }

    showDetails(data);
    detailsPanel.hidden = false;
    form.hidden = true;
    card.dataset.stage = "verify";
    message.textContent = `We found your administrator-approved payment for ${
      data.tutorial_name || "your tutorial"
    } · ${data.package_name || "your package"}. Confirm below to continue.`;
  } catch (error) {
    message.textContent =
      error instanceof Error
        ? error.message
        : "We couldn't verify your invitation. Please contact the ZOT administrator.";
  }
}

confirmVerifiedButton.addEventListener("click", () => {
  if (!invitation) return;
  detailsPanel.hidden = true;
  form.hidden = false;
  card.dataset.stage = "password";
  message.textContent =
    "Your payment is verified. Create a password to activate your ZOT student account.";
  document.getElementById("pwIntro").innerHTML = "";
  const intro = document.getElementById("pwIntro");
  intro.append("Choose a password you will remember. You will sign in with ");
  const em = document.createElement("strong");
  em.textContent = invitation.email;
  intro.append(em, " and this password.");
  pw.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!invitation || !token) return;

  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const submitButton = form.querySelector('button[type="submit"]');
  clearFormError();
  if (!password)
    return showFormError("Please enter a password.", pw);
  if (password.length < 8)
    return showFormError(
      `Your password is too short. It has ${password.length} character${password.length === 1 ? "" : "s"}, and it needs at least 8.`,
      pw
    );
  if (!confirmPassword)
    return showFormError("Please type your password again in the Confirm password box.", pw2);
  if (password !== confirmPassword)
    return showFormError(
      "The two passwords do not match. Check both boxes (tap the eye icon to see what you typed) and try again.",
      pw2
    );

  submitButton.disabled = true;
  submitButton.textContent = "Creating account…";
  message.textContent = "Creating your secure ZOT student account…";

  try {
    const email = String(invitation.email).trim().toLowerCase();
    // Email confirmation is disabled in Supabase Auth. signUp creates the user
    // and returns a session; no OTP or confirmation email is requested here.
    const { data: existingSession } = await supabase.auth.getSession();
    let activeUser = existingSession?.session?.user || null;

    if (activeUser?.email?.toLowerCase() === email) {
      // Allows a student to safely retry finalization if account creation
      // succeeded but a later network request failed.
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) throw updateError;
    } else {
      if (activeUser) {
        await supabase.auth.signOut({ scope: "local" });
        activeUser = null;
      }
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: invitation.full_name || "" } },
        });
      if (signUpError) {
        if (
          /already registered|already been registered|user already registered/i.test(
            signUpError.message || ""
          )
        ) {
          throw new Error(
            "An account already exists for this email. Please contact the ZOT administrator so the existing account can be linked safely."
          );
        }
        throw signUpError;
      }
      activeUser = signUpData?.user || null;
      if (!signUpData?.session || !activeUser) {
        throw new Error(
          "Your account was created, but Supabase did not return a login session. Please contact the ZOT administrator; do not submit another payment."
        );
      }
    }

    const referralCode = document
      .getElementById("referralCode")
      .value.trim()
      .toUpperCase();
    const { data: result, error: registrationError } =
      await supabase.functions.invoke("complete-student-registration", {
        body: { token, referral_code: referralCode || null },
      });

    if (registrationError) {
      let serverMessage = "";
      try {
        serverMessage = (await registrationError.context?.json())?.error || "";
      } catch {
        /* no JSON response */
      }
      throw new Error(
        serverMessage ||
          registrationError.message ||
          "Registration could not be completed."
      );
    }
    if (!result?.success)
      throw new Error(result?.error || "Registration could not be completed.");

    message.textContent = `Registration successful! Your permanent ZOT ID is ${formatZotId(
      result.zot_id
    )}. You are being redirected to your dashboard.`;
    form.hidden = true;
    detailsPanel.hidden = true;
    window.location.href = "/student-dashboard.html?registered=true";
  } catch (error) {
    console.error("ZOT registration error:", error);
    const friendly = friendlyError(error instanceof Error ? error.message : "");
    message.textContent =
      "Your payment is verified. Create a password to activate your ZOT student account.";
    showFormError(friendly.text, friendly.field);
    submitButton.disabled = false;
    submitButton.textContent = "Verify & create my account";
  }
});
