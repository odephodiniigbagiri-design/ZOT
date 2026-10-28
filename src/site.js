```javascript
// Shared look and navigation for every ZOT page.
// Import this file at the top of a page's script: import "./site.js";
import "./site.css";

const TOKEN_KEY = "zot_invitation_token";

// Preserve invitation tokens as students move around the site.
const urlToken = new URLSearchParams(window.location.search).get("token");

if (urlToken) {
  try {
    sessionStorage.setItem(TOKEN_KEY, urlToken);
  } catch {
    // Storage may be blocked; the original URL still works.
  }
}

let savedToken = "";

try {
  savedToken = sessionStorage.getItem(TOKEN_KEY) || "";
} catch {
  savedToken = "";
}

const registerHref = savedToken
  ? "/register.html?token=" + encodeURIComponent(savedToken)
  : "/register.html";

const path = window.location.pathname;
const links = [
  { label: "Join Class", href: "/attend.html", match: "/attend.html" },
  { label: "Home", href: "/", match: "/" },
  { label: "Register", href: registerHref, match: "/register.html" },
  { label: "Student Login", href: "/student-login.html", match: "/student-login.html" },
  { label: "My Dashboard", href: "/student-dashboard.html", match: "/student-dashboard.html" },
  { label: "Admin Login", href: "/admin.html", match: "/admin.html" },
  { label: "Admin Dashboard", href: "/admin-dashboard.html", match: "/admin-dashboard.html" },
];

function linkHtml(link) {
  const current =
    path === link.match ? ' aria-current="page"' : "";

  const cls = link.label.startsWith("Admin")
    ? ' class="is-admin"'
    : "";

  return (
    '<a href="' +
    link.href +
    '"' +
    cls +
    current +
    ">" +
    link.label +
    "</a>"
  );
}

const header = document.createElement("header");
header.className = "site-nav";


    <button
      class="site-nav__toggle"
      type="button"
      aria-expanded="false"
      aria-controls="siteLinks"
    >Menu</button>

    <nav id="siteLinks" class="site-nav__links" aria-label="Main">
      ${links.map(linkHtml).join("")}
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
const navLinks = header.querySelector("#siteLinks");

toggle.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(isOpen));
});
