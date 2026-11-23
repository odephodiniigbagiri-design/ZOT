import { supabase } from "./supabase.js";
import "./site.js";
import "./register.css";
import { EYE, wireEyes } from "./pw-ui.js";

const app = document.getElementById("app");

app.innerHTML = `
  <main class="auth-card">
    <span class="chip">Student login</span>
    <h1>Welcome back</h1>
    <p class="lede">Sign in to access your tutorial dashboard.</p>

    <form id="studentLoginForm">
      <label class="field-label" for="studentEmail">Email address</label>
      <input
        class="input"
        id="studentEmail"
        type="email"
        autocomplete="email"
        required
        placeholder="Enter your registered email"
      />

      <label class="field-label" for="studentPassword">Password</label>
      <div class="pw-wrap">
        <input
          class="input"
          id="studentPassword"
          type="password"
          autocomplete="current-password"
          required
          placeholder="Enter your password"
        />
        ${EYE}
      </div>
      <p class="field-hint" style="text-align:right"><a href="/forgot-password.html">Forgot your password?</a></p>

      <button class="btn btn--block" id="loginButton" type="submit">Sign In</button>
    </form>

    <p id="loginMessage" class="status" role="status"></p>
  </main>
`;

const form = document.getElementById("studentLoginForm");
wireEyes(form);
const message = document.getElementById("loginMessage");
const button = document.getElementById("loginButton");
const params = new URLSearchParams(window.location.search);

if (params.get("reset") === "true") {
  message.textContent =
    "Your password has been changed. Sign in with your email and your new password.";
} else if (params.get("registered") === "true") {
  message.textContent =
    "Registration successful! Please sign in with your email and password.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("studentEmail").value.trim();
  const password = document.getElementById("studentPassword").value;

  button.disabled = true;
  button.textContent = "Signing in...";
  message.textContent = "";

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    if (!data.user) throw new Error("Unable to sign in. Please try again.");

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      await supabase.auth.signOut();
      throw new Error(
        "This account does not have a completed ZOT student profile. Please contact the administrator."
      );
    }

    // Honour only same-site relative destinations (attendance links use this).
    const requestedNext = params.get("next");
    const safeNext =
      requestedNext &&
      requestedNext.startsWith("/") &&
      !requestedNext.startsWith("//") &&
      !requestedNext.includes("\\")
        ? requestedNext
        : "/student-dashboard.html";
    window.location.replace(safeNext);
  } catch (error) {
    console.error("ZOT student login error:", error);
    const raw = error instanceof Error ? error.message : "";
    message.textContent = /invalid login credentials/i.test(raw)
      ? "Your email or password is not correct. Check both (tap the eye icon to see your password), or use “Forgot your password?” below the password box."
      : /failed to fetch|network|load failed/i.test(raw)
        ? "We couldn't reach the server. Check your internet connection and try again."
        : raw || "Sign-in failed. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Sign In";
  }
});
