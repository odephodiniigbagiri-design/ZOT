// Shared look and navigation for every ZOT page.
// Import this one file at the top of a page's script: import "./site.js";
import "./site.css";

const TOKEN_KEY = "zot_invitation_token";

// Remember the invitation token so the Register tab keeps working
// while the student moves around the site.
const urlToken = new URLSearchParams(window.location.search).get("token");
if (urlToken) {
  try {
    sessionStorage.setItem(TOKEN_KEY, urlToken);
  } catch {
    // Storage may be blocked; the link still works from the URL.
  }
}

let savedToken = "";
try {
  savedToken = sessionStorage.getItem(TOKEN_KEY) || "";
} catch {
  savedToken = "";
}

const registerHref = savedToken
  ? `/register.html?token=${encodeURIComponent(savedToken)}`
  : "/register.html";

const studentLinks = [
  { label: "Register", href: registerHref, match: "/register.html" },
  { label: "Student Login", href: "/student-login.html", match: "/student-login.html" },
  { label: "My Dashboard", href: "/student-dashboard.html", match: "/student-dashboard.html" },
];

const adminLinks = [
  { label: "Admin Login", href: "/admin.html", match: "/admin.html" },
  { label: "Admin Dashboard", href: "/admin-dashboard.html", match: "/admin-dashboard.html" },
];

const path = window.location.pathname;

function linkHtml(link, extraClass = "") {
  const current = path === link.match ? ' aria-current="page"' : "";
  const cls = extraClass ? ` class="${extraClass}"` : "";
  return `<a href="${link.href}"${cls}${current}>${link.label}</a>`;
}

const header = document.createElement("header");
header.className = "site-nav";
header.innerHTML = `
  <div class="site-nav__inner">
    <a class="site-brand" href="/" aria-label="Zenith Online Tutorials home">
      <img src="/zot-logo.jpg" alt="" width="42" height="42" />
      <span>Zenith Online Tutorials<small>Student Portal</small></span>
    </a>
    <button class="site-nav__toggle" type="button"
      aria-expanded="false" aria-controls="siteLinks">Menu</button>
    <nav id="siteLinks" class="site-nav__links" aria-label="Main">
      ${studentLinks.map((l) => linkHtml(l)).join("")}
      <span class="site-nav__divider" aria-hidden="true"></span>
      ${adminLinks.map((l) => linkHtml(l, "is-admin")).join("")}
    </nav>
  </div>
`;

const footer = document.createElement("footer");
footer.className = "site-footer";
footer.textContent =
  `© ${new Date().getFullYear()} Zenith Online Tutorials · Student Portal`;

document.body.prepend(header);
document.body.append(footer);

const toggle = header.querySelector(".site-nav__toggle");
const links = header.querySelector("#siteLinks");
toggle.addEventListener("click", () => {
  const open = links.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(open));
});
