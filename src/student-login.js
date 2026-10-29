
import { supabase } from "./supabase.js";
import "./site.js";

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
      <input
        class="input"
        id="studentPassword"
        type="password"
        autocomplete="current-password"
        required
        placeholder="Enter your password"
      />

      <button class="btn btn--block" id="loginButton" type="submit">Sign In</button>
    </form>

    <p id="loginMessage" class="status" role="status"></p>
  </main>
`;

const form = document.getElementById("studentLoginForm");
const message = document.getElementById("loginMessage");
const button = document.getElementById("loginButton");
const params = new URLSearchParams(window.location.search);

if (params.get("registered") === "true") {
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

    window.location.href = "/student-dashboard.html";
  } catch (error) {
    console.error("ZOT student login error:", error);
    message.textContent =
      error instanceof Error
        ? error.message
        : "Sign-in failed. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Sign In";
  }
});
