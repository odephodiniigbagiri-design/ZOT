
import { supabase } from "./supabase.js";
import "./site.js";

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

      <h3 class="section-title">Your Tutorial Enrollments</h3>
      <div id="enrollmentList" class="card-grid"></div>

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
