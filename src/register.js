import { supabase } from "./supabase.js";
import "./site.js";

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
    <form id="registrationForm" hidden>
      <label class="field-label" for="password">Create a password</label>
      <input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required />
      <label class="field-label" for="confirmPassword">Confirm password</label>
      <input class="input" id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
      <label class="field-label" for="referralCode">Referral code (optional)</label> <input class="input input--upper" id="referralCode" name="referralCode" type="text" autocomplete="off" maxlength="32" placeholder="Enter a friend's ZOT referral code" />
      <button class="btn btn--block" type="submit">Verify & create my account</button>
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
  document.getElementById("password").focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!invitation || !token) return;

  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const submitButton = form.querySelector('button[type="submit"]');
  if (password.length < 8)
    return (message.textContent =
      "Your password must contain at least 8 characters.");
  if (password !== confirmPassword)
    return (message.textContent = "Your passwords do not match.");

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
    message.textContent =
      error instanceof Error
        ? error.message
        : "Registration failed. Please try again or contact the administrator.";
    submitButton.disabled = false;
    submitButton.textContent = "Try Again";
  }
});
