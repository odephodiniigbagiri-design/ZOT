import { supabase } from "./supabase.js";
import "./site.js";
import "./student-dashboard.css";
import { ROUND_COUNT, scheduledStart, fmtDate, clockOffset } from "./mock-common.js";

document.body.classList.add("dash");

const app = document.getElementById("app");

app.innerHTML = `
  <main class="dash-wrap">
    <section id="dashboardMessage" class="dash-status">Loading your dashboard...</section>

    <div id="studentDetails" hidden>
      <header class="dash-head">
        <div>
          <h1>Welcome back, <span id="studentName"></span></h1>
          <p>Your mocks, classes and attendance in one place.</p>
        </div>
        <button class="d-btn line" id="logoutButton" type="button">Sign out</button>
      </header>

      <div class="dash-grid">
        <div class="col">
          <section id="mockCard" class="card mock o-mock" aria-live="polite"></section>

          <section class="card o-att">
            <h2>Attendance</h2>
            <div id="attendanceSummary" class="attsum"></div>
            <div id="attendanceList"></div>
          </section>
        </div>

        <div class="col">
          <section class="idcard o-id" aria-label="Your student ID">
            <div class="idtop"><img src="/zot-logo.jpg" alt="" width="40" height="40" />Zenith Tutorials</div>
            <div class="idno" id="studentZotId">—</div>
            <div class="idname" id="studentCardName"></div>
            <p class="idmail" id="studentEmail">—</p>
            <button class="d-btn onDark sm" id="copyId" type="button">Copy ID</button>
          </section>

          <section class="card o-groups">
            <h2>Join your class groups</h2>
            <div class="groups">
              <a class="gl wa" href="https://chat.whatsapp.com/EtFKzu9HVJa1A91DKZzAsE?s=cl&amp;p=a&amp;iam=2" target="_blank" rel="noopener noreferrer">
                <i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4Z"/></svg></i>
                <div><b>WhatsApp group</b><span>Announcements and updates</span></div><em>Join</em>
              </a>
              <a class="gl tg" href="https://t.me/addlist/wBkNa_jIcMRjZDA0" target="_blank" rel="noopener noreferrer">
                <i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 3.4 2.9 10.6c-1.3.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.1.8.7.8.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.2-.5-1.8-1.3-1.5ZM9 13.2l9.4-5.9c.4-.3.8-.1.5.2l-7.8 7-.3 3.2L9 13.2Z"/></svg></i>
                <div><b>Telegram class groups</b><span>Every subject classroom in one folder</span></div><em>Join</em>
              </a>
            </div>
          </section>

          <section class="card o-enr">
            <h2>Your enrollments</h2>
            <div id="enrollmentList" class="lst"></div>
          </section>

          <section class="card o-ref">
            <h2>Your referral codes</h2>
            <div id="referralList" class="lst"></div>
          </section>
        </div>
      </div>
    </div>
  </main>
`;

const message = document.getElementById("dashboardMessage");
const details = document.getElementById("studentDetails");

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function pill(text, tone) {
  const p = el("span", "pill", text);
  p.dataset.tone = tone;
  return p;
}

function formatZotId(id) {
  return `ZOT${String(id).padStart(5, "0")}`;
}

function showMessage(text) {
  message.textContent = text;
}

function classWhen(value) {
  return value
    ? new Date(value).toLocaleString([], {
        weekday: "short", hour: "numeric", minute: "2-digit",
      })
    : "Date not set";
}

let mockTimer = null;

async function loadMockCard() {
  clearInterval(mockTimer);
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
  let live = null;

  for (let n = 1; n <= ROUND_COUNT; n++) {
    const ch = rows.find((r) => r.round_no === n);
    if (ch?.attempt_id && !ch.submitted_at && now() < Date.parse(ch.attempt_ends_at)) {
      title = `Round ${n} in progress`;
      line = "Your timer is running. Continue your mock.";
      action = [`/mock-exam.html?attempt=${ch.attempt_id}`, "Continue"];
      live = "In progress";
      break;
    }
    if (ch && !ch.attempt_id && now() >= Date.parse(ch.starts_at) && now() <= Date.parse(ch.closes_at)) {
      title = `Round ${n} is open now`;
      line = `${ch.duration_minutes} minutes. Start when you are ready.`;
      action = ["/mocks.html", "Start Mock"];
      live = "Live now";
      break;
    }
    const start = ch ? Date.parse(ch.starts_at) : scheduledStart(n);
    if (now() < start) {
      title = `Round ${n}`;
      if (ch) {
        line = `Starts ${fmtDate(start)}`;
        target = start;
      } else {
        line = `${fmtDate(start)}. Pending until the questions are published.`;
      }
      break;
    }
  }

  const kids = [];
  if (live) {
    const tag = el("span", "live");
    tag.append(el("i"), document.createTextNode(live));
    kids.push(tag);
  }
  kids.push(el("h2", "", title), el("p", "line", line));

  if (target) {
    const grid = el("div", "count");
    const cells = {};
    for (const [k, label] of [["d", "days"], ["h", "hours"], ["m", "min"], ["s", "sec"]]) {
      const cell = el("div");
      cells[k] = el("b", "", "0");
      cell.append(cells[k], el("span", "", label));
      grid.append(cell);
    }
    const pad = (v) => String(v).padStart(2, "0");
    const tick = () => {
      const left = Math.max(0, target - now());
      const s = Math.floor(left / 1000);
      cells.d.textContent = String(Math.floor(s / 86400));
      cells.h.textContent = pad(Math.floor((s % 86400) / 3600));
      cells.m.textContent = pad(Math.floor((s % 3600) / 60));
      cells.s.textContent = pad(s % 60);
      if (left <= 0) {
        clearInterval(mockTimer);
        loadMockCard();
      }
    };
    mockTimer = setInterval(tick, 1000);
    tick();
    kids.push(grid);
  }

  const acts = el("div", "acts");
  const main = el("a", "d-btn red", action ? action[1] : "Open Mock Challenge");
  main.href = action ? action[0] : "/mocks.html";
  acts.append(main);
  if (action) {
    const all = el("a", "d-btn onDark", "History");
    all.href = "/mocks.html";
    acts.append(all);
  }
  kids.push(acts);
  box.replaceChildren(...kids);
}

async function loadAttendance() {
  const list = document.getElementById("attendanceList");
  const summary = document.getElementById("attendanceSummary");
  list.replaceChildren();
  summary.replaceChildren();

  try {
    const { data, error } = await supabase.rpc("zot_student_attendance");
    if (error) throw error;

    const records = Array.isArray(data) ? data : [];

    if (records.length === 0) {
      list.append(el("p", "empty", "No classes recorded yet. Your attendance will show here after your first class."));
      return;
    }

    const held = records.filter((r) => r.status === "present" || r.status === "absent");
    const presentCount = records.filter((r) => r.status === "present").length;
    if (held.length) {
      const pct = Math.round((presentCount / held.length) * 100);
      summary.innerHTML = `
        <div class="ring" data-pct="${pct}">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle class="trk" cx="50" cy="50" r="42"></circle>
            <circle class="val" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="0 100"></circle>
          </svg><b>${pct}%</b>
        </div>
        <p><strong>Present for ${presentCount} of ${held.length} classes</strong>Keep showing up to every live class.</p>`;
    }

    const labels = {
      present: ["ok", "Present"],
      absent: ["bad", "Absent"],
      open: ["warn", "Link open: use the link from your tutor"],
      upcoming: ["", "Upcoming"],
    };

    const ul = el("ul", "rows");
    for (const record of records) {
      const li = el("li", "row");
      const d = record.session_date ? new Date(record.session_date) : null;
      const when = el("div", "when");
      when.append(
        el("b", "", d ? String(d.getDate()) : "-"),
        el("span", "", d ? d.toLocaleString([], { month: "short" }) : "")
      );

      const info = el("div");
      info.append(
        el("h3", "", record.title || "Class"),
        el("p", "", `${record.tutorial_name || "Tutorial"}, ${classWhen(record.session_date)}`)
      );
      if (record.status === "present" && record.marked_at) {
        info.append(el("p", "", `Marked at ${new Date(record.marked_at).toLocaleString()}`));
      }

      const [tone, text] = labels[record.status] || ["", "Status unavailable"];
      li.append(when, info, pill(text, tone));
      ul.append(li);
    }
    list.append(ul);
  } catch (error) {
    console.error("ZOT attendance error:", error);
    summary.replaceChildren();
    list.append(el("p", "empty", "We couldn't load your attendance right now."));
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
      showMessage("Your student profile was not found. Please contact the ZOT administrator.");
      return;
    }

    const zotId = formatZotId(profile.zot_id);
    document.getElementById("studentName").textContent = profile.full_name;
    document.getElementById("studentCardName").textContent = profile.full_name;
    document.getElementById("studentEmail").textContent = user.email || "Not available";
    document.getElementById("studentZotId").textContent = zotId;

    const copyId = document.getElementById("copyId");
    copyId.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(zotId);
        copyId.textContent = "Copied";
      } catch {
        copyId.textContent = "Copy unavailable";
      }
      setTimeout(() => (copyId.textContent = "Copy ID"), 1800);
    });

    const { data: enrollments, error: enrollmentError } = await supabase
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
      enrollmentList.append(el("p", "empty", "No enrollments yet. Send your payment receipt to get enrolled."));
    } else {
      const statusLabels = {
        approved: ["ok", "Confirmed"],
        awaiting_payment: ["warn", "Awaiting payment"],
        payment_pending_review: ["warn", "Payment under review"],
        rejected: ["bad", "Not approved"],
        cancelled: ["bad", "Cancelled"],
      };
      for (const enrollment of enrollments) {
        const card = el("article");
        const info = el("div");
        info.append(
          el("h3", "", enrollment.tutorials?.name || "Tutorial"),
          el("p", "", `Package: ${enrollment.tutorial_packages?.name || "Not specified"}`)
        );
        const [tone, text] = statusLabels[enrollment.status] || ["", "Status unavailable"];
        card.append(info, pill(text, tone));
        enrollmentList.append(card);
      }
    }

    const { data: referralCodes, error: referralError } = await supabase
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
      referralList.append(el("p", "empty", "No referral codes yet."));
    } else {
      for (const referral of referralCodes) {
        const item = el("article");
        const info = el("div");
        info.append(
          el("div", "code", referral.code),
          el("p", "", `People referred: ${referral.referrals?.length ?? 0}`)
        );

        const copyButton = el("button", "d-btn line sm", "Copy code");
        copyButton.type = "button";
        copyButton.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(referral.code);
            copyButton.textContent = "Copied!";
          } catch {
            copyButton.textContent = "Copy unavailable";
          }
        });

        item.append(info, copyButton);
        referralList.append(item);
      }
    }

    await loadAttendance();
    await loadMockCard();

    message.hidden = true;
    details.hidden = false;

    // Fill the attendance ring after the page is visible so it animates.
    const ring = document.querySelector(".ring .val");
    if (ring) {
      const pct = document.querySelector(".ring").dataset.pct;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => ring.setAttribute("stroke-dasharray", `${pct} 100`))
      );
    }
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
    message.hidden = false;
    return;
  }

  window.location.href = "/student-login.html";
});

loadDashboard();
