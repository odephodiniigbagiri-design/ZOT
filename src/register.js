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
    <p class="lede">
      Verify your email first, then complete your registration to access
      your tutorial dashboard.
    </p>

    <ol class="steps" aria-label="Registration steps">
      <li>Verify email</li>
      <li>Your details</li>
      <li>Dashboard</li>
    </ol>

    <div id="registrationMessage" class="status" role="status" aria-live="polite">
      Checking your invitation link...
    </div>

    <!-- STAGE 1: email verification only -->
    <form id="verifyForm" hidden>
      <label class="field-label" for="verifyEmail">Email address</label>
      <input class="input" id="verifyEmail" name="verifyEmail" type="email"
        autocomplete="email" required readonly />

      <button class="btn btn--block" type="submit" id="verifyButton">
        Verify my email
      </button>
    </form>

    <!-- STAGE 2: details, shown only after the email is verified -->
    <form id="registrationForm" hidden>
      <label class="field-label" for="fullName">Full name</label>
      <input class="input" id="fullName" name="fullName" type="text"
        autocomplete="name" required maxlength="120" />

      <label class="field-label" for="email">Email address</label>
      <input class="input" id="email" name="email" type="email"
        autocomplete="email" required readonly />

      <label class="field-label" for="phone">Phone number</label>
      <input class="input" id="phone" name="phone" type="tel"
        autocomplete="tel" required maxlength="30" />

      <label class="field-label" for="referralCode">Referral code (optional)</label>
      <input class="input input--upper" id="referralCode" name="referralCode"
        type="text" autocomplete="off" maxlength="32"
        placeholder="Enter a friend's ZOT referral code" />

      <label class="field-label" for="password">Create a password</label>
      <input class="input" id="password" name="password" type="password"
        autocomplete="new-password" minlength="8" required />

      <button class="btn btn--block" type="submit">Create Account</button>
    </form>
  </main>
`;

const card = document.querySelector(".auth-card");
const message = document.getElementById("registrationMessage");
const verifyForm = document.getElementById("verifyForm");
const verifyButton = document.getElementById("verifyButton");
const form = document.getElementById("registrationForm");

let invitedEmail = "";

if (!token) {
  message.textContent =
    "No invitation token was found. Please open the registration link sent to you by the ZOT administrator.";
} else {
  message.textContent = "Verifying your invitation securely...";

  try {
    const { data, error } = await supabase.functions.invoke(
      "verify-registration-invitation",
      {
        body: { token },
      }
    );

    if (error || !data?.valid) {
      throw new Error(
        data?.error || error?.message || "Invitation verification failed."
      );
    }

    invitedEmail = String(data.email).trim().toLowerCase();

    const invitationSummary =
      `Tutorial: ${data.tutorial_name || "ZOT tutorial"}. ` +
      `Package: ${data.package_name || "Selected package"}. ` +
      `Invitation expires: ${new Date(data.expires_at).toLocaleString()}.`;

    // Is the student already signed in with the invited, confirmed email?
    // (This is the case after they click the link in the Supabase email.)
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData?.session?.user;

    const emailIsVerified =
      sessionUser &&
      Boolean(sessionUser.email_confirmed_at) &&
      sessionUser.email?.toLowerCase() === invitedEmail;

    if (emailIsVerified) {
      // STAGE 2: show the details form.
      message.textContent =
        `Email verified! Please complete your details below. ${invitationSummary}`;
      document.getElementById("email").value = invitedEmail;
      card.dataset.stage = "details";
      form.hidden = false;
    } else {
      // STAGE 1: ask only for email verification.
      let signedOutOtherAccount = false;

      if (sessionUser) {
        // A different account is signed in on this browser. Sign it out
        // on this device so it cannot interfere with registration.
        await supabase.auth.signOut({ scope: "local" });
        signedOutOtherAccount = true;
      }

      const hashParams = new URLSearchParams(
        window.location.hash.replace(/^#/, "")
      );
      const linkError = hashParams.get("error_description");

      document.getElementById("verifyEmail").value = invitedEmail;

      if (linkError) {
        message.textContent =
          "That verification link is invalid or has expired. " +
          "Click the button below to receive a new one. " +
          invitationSummary;
      } else {
        message.textContent =
          `Invitation verified! ${invitationSummary} ` +
          "Click the button below and we will email you a verification link." +
          (signedOutOtherAccount
            ? " (Another account was signed in on this browser, so it was signed out.)"
            : "");
      }

      verifyForm.hidden = false;
    }
  } catch (error) {
    message.textContent =
      error.message ||
      "We couldn't verify your invitation. Please contact the ZOT administrator.";
  }
}

// STAGE 1 submit: send the verification email (no password needed yet).
verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  verifyButton.disabled = true;
  verifyButton.textContent = "Sending...";

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: invitedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo:
          `${window.location.origin}/register.html?token=${encodeURIComponent(token)}`,
      },
    });

    if (error) {
      throw error;
    }

    message.textContent =
      `We sent a verification link to ${invitedEmail}. ` +
      "Open that email and click the link to continue your registration. " +
      "If you don't see it, check your spam folder.";

    verifyButton.textContent = "Resend verification email";
  } catch (error) {
    message.textContent =
      error instanceof Error
        ? error.message
        : "We couldn't send the verification email. Please try again.";

    verifyButton.textContent = "Verify my email";
  } finally {
    verifyButton.disabled = false;
  }
});

// STAGE 2 submit: set the password, then finish registration on the server.
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fullName = document.getElementById("fullName").value.trim();
  const email = document.getElementById("email").value.trim().toLowerCase();
  const phone = document.getElementById("phone").value.trim();
  const password = document.getElementById("password").value;
  const submitButton = form.querySelector('button[type="submit"]');

  submitButton.disabled = true;
  submitButton.textContent = "Processing...";

  try {
    if (!token) {
      throw new Error("Your invitation token is missing.");
    }

    // Confirm the signed-in user owns the invited email.
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData.user) {
      throw new Error(
        "Your email session has expired. Please reload this page and verify your email again."
      );
    }

    if (
      !userData.user.email_confirmed_at ||
      userData.user.email?.toLowerCase() !== email
    ) {
      throw new Error(
        "Please verify the invited email address before continuing."
      );
    }

    // Save the password chosen by the student. If this step is retried with
    // the same password, Supabase reports "same password"; that is fine.
    const { error: passwordError } = await supabase.auth.updateUser({
      password,
    });

    if (
      passwordError &&
      passwordError.code !== "same_password" &&
      !/different from the old password/i.test(passwordError.message || "")
    ) {
      throw passwordError;
    }

    // Finalize profile, ZOT ID, enrollment, referral and referral code.
    const referralCode =
      document.getElementById("referralCode").value.trim().toUpperCase();

    const { data: result, error: registrationError } =
      await supabase.functions.invoke("complete-student-registration", {
        body: {
          token,
          full_name: fullName,
          phone,
          referral_code: referralCode || null,
        },
      });

    if (registrationError) {
      let serverMessage = "";
      try {
        const errorBody = await registrationError.context?.json();
        serverMessage = errorBody?.error || errorBody?.message || "";
      } catch {
        // The response had no readable JSON body; fall back below.
      }
      throw new Error(
        serverMessage ||
          registrationError.message ||
          "Registration could not be completed."
      );
    }

    if (!result?.success) {
      throw new Error(
        result?.error || "Registration could not be completed."
      );
    }

    message.textContent =
      `Registration successful! Your permanent ZOT ID is ${formatZotId(result.zot_id)}. ` +
      `Tutorial: ${result.tutorial_name}. ` +
      `Package: ${result.package_name}. ` +
      `Referral code: ${result.referral_code}.`;

    form.hidden = true;
    window.location.href = "/student-login.html?registered=true";
  } catch (error) {
    console.error("ZOT registration error:", error);

    message.textContent =
      error instanceof Error
        ? error.message
        : JSON.stringify(error);

    submitButton.textContent = "Try Again";
  } finally {
    submitButton.disabled = false;

    if (!form.hidden && submitButton.textContent === "Processing...") {
      submitButton.textContent = "Create Account";
    }
  }
});
