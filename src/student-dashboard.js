
import { supabase } from "./supabase.js";
import "./site.js";
import {
  ROUND_COUNT, scheduledStart, fmtDate, fmtCountdown, clockOffset,
} from "./mock-common.js";

const app = document.getElementById("app");

app.innerHTML = `
  <main class="auth-card auth-card--wide">
    <span class="chip">Student dashboard</span>

    <section id="dashboardMessage" class="status">
      Loading your dashboard...
    </section>

    <section id="studentDetails" class="stack" hidden>
      <h1>Welcome, <span id="studentName"></span>!</h1>
      <p class="lede">Email: <span id="studentEmail">—</span></p>

      <div class="zot-id-card">
        <p>Permanent ZOT ID</p>
        <h2 id="studentZotId">—</h2>
      </div>

      <h3 class="section-title">Mock Challenge</h3>
      <div id="mockCard" class="card-grid"></div>

      <h3 class="section-title">Join Your Class Groups</h3>
      <div class="card-grid">
        <article class="item-card">
          <h4>WhatsApp Group</h4>
          <p>Announcements and updates from Zenith Tutorials.</p>
          <a
            class="btn"
            style="display:inline-block;text-decoration:none;text-align:center"
            href="https://chat.whatsapp.com/EtFKzu9HVJa1A91DKZzAsE?s=cl&amp;p=a&amp;iam=2"
            target="_blank"
            rel="noopener noreferrer"
          >Join WhatsApp Group</a>
        </article>
        <article class="item-card">
          <h4>Telegram Class Groups</h4>
          <p>Your subject classrooms, all in one folder.</p>
          <a
            class="btn"
            style="display:inline-block;text-decoration:none;text-align:center"
            href="https://t.me/addlist/wBkNa_jIcMRjZDA0"
            target="_blank"
            rel="noopener noreferrer"
          >Join Telegram Groups</a>
        </article>
      </div>

      <h3 class="section-title">Your Tutorial Enrollments</h3>
      <div id="enrollmentList" class="card-grid"></div>

      <h3 class="section-title">Your Attendance</h3>
      <p id="attendanceSummary" class="lede"></p>
      <div id="attendanceList" class="card-grid"></div>

      <h3 class="section-title">Your Referral Codes</h3>
      <div id="referralList" class="card-grid"></div>

      <button class="btn btn--alt" id="logoutButton" type="button">Sign Out</button>
    </section>
  </main>
`;

const message = document.getElementById("dashboardMessage");
const details = document.getElementById("studentDetails");

function formatZotId(id) {
  return `ZOT${String(id).padStart(5, "0")}`;
}

function showMessage(text) {
  message.textContent = text;
}

function formatClassDate(value) {
  return value ? new Date(value).toLocaleString() : "Date not set";
}

async function loadMockCard() {
  const box = document.getElementById("mockCard");
  let rows = [];
  let offset = 0;
  try {
    const { data, error } = await supabase.rpc("zot_mock_list");
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
    if (rows.length) offset = clockOffset(rows[0].server_now);
  } catch (error) {
    // Mock tables not set up yet: fall back to the fixed Sunday schedule.
    console.error("ZOT mock error:", error);
  }
  const now = () => Date.now() + offset;

  let title = "Mock Challenge";
  let line = "A new mock every Sunday.";
  let target = null;
  let action = null;

  for (let n = 1; n <= ROUND_COUNT; n++) {
    const ch = rows.find((r) => r.round_no === n);
    if (ch?.attempt_id && !ch.submitted_at && now() < Date.parse(ch.attempt_ends_at)) {
      title = `Round ${n} in progress`;
      line = "Your timer is running. Continue your mock.";
      action = [`/mock-exam.html?attempt=${ch.attempt_id}`, "Continue"];
      break;
    }
    if (ch && !ch.attempt_id && now() >= Date.parse(ch.starts_at) && now() <= Date.parse(ch.closes_at)) {
      title = `Round ${n} is open now`;
      line = `${ch.duration_minutes} minutes. Start when you are ready.`;
      action = ["/mocks.html", "Start Mock"];
      break;
    }
    const start = ch ? Date.parse(ch.starts_at) : scheduledStart(n);
    if (now() < start) {
      title = `Round ${n}`;
      if (ch) {
        line = "Starts in ";
        target = start;
      } else {
        line = `${fmtDate(start)} · Pending`;
      }
      break;
    }
  }

  const card = document.createElement("article");
  card.className = "item-card";
  const h = document.createElement("h4");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = line;
  card.append(h, p);

  if (target) {
    const cd = document.createElement("strong");
    const tick = () => {
      const left = target - now();
      cd.textContent = fmtCountdown(left);
      if (left <= 0) {
        clearInterval(timer);
        loadMockCard();
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
    p.append(cd);
  }

  const link = document.createElement("a");
  link.className = "btn";
  link.style.cssText = "display:inline-block;text-decoration:none;text-align:center";
  link.href = action ? action[0] : "/mocks.html";
  link.textContent = action ? action[1] : "Open Mock Challenge";
  card.append(link);

  if (action) {
    const all = document.createElement("a");
    all.className = "btn btn--alt";
    all.style.cssText = "display:inline-block;text-decoration:none;text-align:center;margin-left:.5rem";
    all.href = "/mocks.html";
    all.textContent = "History";
    card.append(all);
  }
  box.replaceChildren(card);
}

async function loadAttendance() {
  const list = document.getElementById("attendanceList");
  const summary = document.getElementById("attendanceSummary");
  list.replaceChildren();

  try {
    const { data, error } = await supabase.rpc("zot_student_attendance");
    if (error) throw error;

    const records = Array.isArray(data) ? data : [];

    if (records.length === 0) {
      summary.textContent = "";
      list.textContent = "No classes have been recorded yet.";
      return;
    }

    const held = records.filter(
      (r) => r.status === "present" || r.status === "absent"
    );
    const presentCount = records.filter((r) => r.status === "present").length;
    summary.textContent = held.length
      ? `Present for ${presentCount} of ${held.length} classes.`
      : "";

    // Reuses existing badge colours: approved = green, rejected = red,
    // awaiting_payment = amber.
    const labels = {
      present: ["approved", "Present"],
      absent: ["rejected", "Absent"],
      open: ["awaiting_payment", "Link open: use the link from your tutor"],
      upcoming: ["awaiting_payment", "Upcoming"],
    };

    for (const record of records) {
      const card = document.createElement("article");
      card.className = "item-card";

      const title = document.createElement("h4");
      title.textContent = record.title || "Class";

      const course = document.createElement("p");
      course.textContent = record.tutorial_name || "Tutorial";

      const when = document.createElement("p");
      when.textContent = `Class: ${formatClassDate(record.session_date)}`;

      const badge = document.createElement("p");
      const [badgeStatus, badgeText] = labels[record.status] || [
        "",
        "Status unavailable",
      ];
      badge.className = "badge";
      badge.dataset.status = badgeStatus;
      badge.textContent = badgeText;

      card.append(title, course, when, badge);

      if (record.status === "present" && record.marked_at) {
        const marked = document.createElement("p");
        marked.textContent = `Marked at ${new Date(
          record.marked_at
        ).toLocaleString()}`;
        card.append(marked);
      }

      list.appendChild(card);
    }
  } catch (error) {
    console.error("ZOT attendance error:", error);
    summary.textContent = "";
    list.textContent = "We couldn't load your attendance right now.";
  }
}

async function loadDashboard() {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) throw authError;

    if (!user) {
      showMessage("Please sign in to access your student dashboard. ");
      const loginLink = document.createElement("a");
      loginLink.href = "/student-login.html";
      loginLink.textContent = "Go to student login";
      message.append(loginLink);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, zot_id, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      showMessage(
        "Your student profile was not found. Please contact the ZOT administrator."
      );
      return;
    }

    document.getElementById("studentName").textContent =
      profile.full_name;
    document.getElementById("studentEmail").textContent =
      user.email || "Not available";

    document.getElementById("studentZotId").textContent =
      formatZotId(profile.zot_id);

    const { data: enrollments, error: enrollmentError } =
      await supabase
        .from("tutorial_enrollments")
        .select(`
          status,
          tutorials ( name ),
          tutorial_packages ( name )
        `)
        .eq("student_id", user.id);

    if (enrollmentError) throw enrollmentError;

    const enrollmentList = document.getElementById("enrollmentList");
    enrollmentList.replaceChildren();

    if (!enrollments || enrollments.length === 0) {
      enrollmentList.textContent = "No tutorial enrollments found.";
    } else {
      for (const enrollment of enrollments) {
        const card = document.createElement("article");
        card.className = "item-card";

        const title = document.createElement("h4");
        title.textContent =
          enrollment.tutorials?.name || "Tutorial";

        const packageName = document.createElement("p");
        packageName.textContent =
          `Package: ${enrollment.tutorial_packages?.name || "Not specified"}`;

        const status = document.createElement("p");
        const statusLabels = {
            approved: "Enrollment confirmed",
            awaiting_payment: "Awaiting payment",
            payment_pending_review: "Payment under review",
            rejected: "Enrollment not approved",
            cancelled: "Enrollment cancelled",
        };

        status.className = "badge";
        status.dataset.status = enrollment.status;
        status.textContent =
            statusLabels[enrollment.status] || "Status unavailable";

        card.append(title, packageName, status);
        enrollmentList.appendChild(card);
      }
    }

    const { data: referralCodes, error: referralError } =
        await supabase
            .from("referral_codes")
            .select(`
                id,
                code,
                tutorial_id,
                referrals ( id )
            `)
            .eq("owner_id", user.id);
    if (referralError) throw referralError;

    const referralList = document.getElementById("referralList");
    referralList.replaceChildren();

    if (!referralCodes || referralCodes.length === 0) {
      referralList.textContent = "No referral codes found yet.";
    } else {
      for (const referral of referralCodes) {
        const item = document.createElement("article");
        item.className = "item-card";

        const code = document.createElement("p");
        code.className = "item-code";
        code.textContent = `Referral code: ${referral.code}`;
        const count = document.createElement("p");
        count.textContent =
            `People referred: ${referral.referrals?.length ?? 0}`;

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "btn btn--alt";
        copyButton.textContent = "Copy code";

        copyButton.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(referral.code);
            copyButton.textContent = "Copied!";
          } catch {
            copyButton.textContent = "Copy unavailable";
          }
        });

        item.append(code, count, copyButton);
        referralList.appendChild(item);
      }
    }

    await loadAttendance();
    await loadMockCard();

    message.hidden = true;
    details.hidden = false;
  } catch (error) {
    console.error("ZOT dashboard error:", error);
    showMessage(
      "We couldn't load your dashboard. Please refresh the page or contact the ZOT administrator."
    );
  }
}

document.getElementById("logoutButton").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showMessage("Sign out failed. Please try again.");
    return;
  }

  window.location.href = "/student-login.html";
});

loadDashboard();
