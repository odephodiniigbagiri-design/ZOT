import { supabase } from "./supabase.js";
import "./site.js";

const app = document.getElementById("app");
const code = new URLSearchParams(window.location.search).get("code");

app.innerHTML = `
  <main class="auth-card stack">
    <span class="chip">Class attendance</span>
    <h1>Mark your attendance</h1>

    <div id="attendMessage" class="status" role="status" aria-live="polite">
      Checking your attendance link...
    </div>

    <div id="classInfo" class="zot-id-card" hidden>
      <p id="classTutorial"></p>
      <h2 id="classTitle"></h2>
      <p id="classWhen"></p>
    </div>

    <button class="btn btn--block" id="markButton" type="button" hidden>
      Mark me present
    </button>

    <a class="btn btn--block" id="loginLink" href="/student-login.html" hidden>
      Sign in to continue
    </a>

    <a class="btn btn--alt btn--block" id="dashboardLink"
      href="/student-dashboard.html" hidden>
      Go to my dashboard
    </a>
  </main>
`;

const message = document.getElementById("attendMessage");
const classInfo = document.getElementById("classInfo");
const markButton = document.getElementById("markButton");
const loginLink = document.getElementById("loginLink");
const dashboardLink = document.getElementById("dashboardLink");

function showClass(info) {
  document.getElementById("classTutorial").textContent =
    info.tutorial_name || "Tutorial";
  document.getElementById("classTitle").textContent = info.title || "Class";
  document.getElementById("classWhen").textContent = info.session_date
    ? new Date(info.session_date).toLocaleString()
    : "";
  classInfo.hidden = false;
}

function showMarked(markedAt) {
  message.textContent =
    "You are marked present for this class" +
    (markedAt ? ` (${new Date(markedAt).toLocaleString()}).` : ".");
  markButton.hidden = true;
  dashboardLink.hidden = false;
}

async function start() {
  if (!code) {
    message.textContent =
      "No attendance link was found. Please open the link your tutor posted in the class.";
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    message.textContent =
      "Please sign in with your ZOT student account to mark your attendance.";
    const back = `/attend.html?code=${encodeURIComponent(code)}`;
    loginLink.href = `/student-login.html?next=${encodeURIComponent(back)}`;
    loginLink.hidden = false;
    return;
  }

  const { data: info, error } = await supabase.rpc("zot_attendance_link_info", {
    p_code: code,
  });

  if (error) {
    console.error("Attendance link error:", error);
    message.textContent = error.message || "We couldn't check this link.";
    return;
  }

  if (info.reason === "invalid") {
    message.textContent =
      "This attendance link is not valid. Please use the latest link from your tutor.";
    return;
  }

  showClass(info);

  if (info.already_marked) {
    showMarked(info.marked_at);
    return;
  }

  if (!info.valid) {
    message.textContent =
      "This attendance link has expired. Ask your tutor for a new one.";
    return;
  }

  if (!info.enrolled) {
    message.textContent =
      "You are not enrolled in this tutorial, so you cannot mark attendance for it.";
    return;
  }

  message.textContent =
    "Check that this is your class, then press the button below. " +
    `This link expires at ${new Date(info.expires_at).toLocaleTimeString()}.`;
  markButton.hidden = false;
}

markButton.addEventListener("click", async () => {
  markButton.disabled = true;
  markButton.textContent = "Marking...";

  try {
    const { data, error } = await supabase.rpc("zot_mark_attendance", {
      p_code: code,
    });

    if (error) throw error;

    showMarked(data.marked_at);
  } catch (error) {
    console.error("Mark attendance error:", error);
    message.textContent =
      error.message || "We couldn't mark your attendance. Please try again.";
    markButton.textContent = "Mark me present";
  } finally {
    markButton.disabled = false;
  }
});

start().catch((error) => {
  console.error("Attendance page error:", error);
  message.textContent =
    "Something went wrong. Please refresh the page or contact the administrator.";
});
