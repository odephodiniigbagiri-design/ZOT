import { supabase } from "./supabase.js";

// Round 1 opens Sunday 13 Dec 2026, 10:00 AM Nigeria time. One round every Sunday after.
export const FIRST_ROUND_AT = Date.parse("2026-12-13T10:00:00+01:00");
export const ROUND_COUNT = 12;
const WEEK = 7 * 24 * 3600 * 1000;

export const scheduledStart = (round) => FIRST_ROUND_AT + (round - 1) * WEEK;

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function fmtCountdown(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p = (x) => String(x).padStart(2, "0");
  return d > 0 ? `${d}d ${p(h)}h ${p(m)}m ${p(s)}s` : `${p(h)}h ${p(m)}m ${p(s)}s`;
}

export function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// Difference between the server clock and this phone's clock, so timers can't be cheated by changing the phone time.
export const clockOffset = (serverNowIso) => Date.parse(serverNowIso) - Date.now();

export async function requireStudent(messageEl) {
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data?.user || null;
  } catch {
    user = null;
  }
  if (!user) {
    messageEl.textContent = "Please sign in to continue. ";
    messageEl.append(el("a", { href: "/student-login.html", text: "Go to student login" }));
  }
  return user;
}

// Calls fn(remainingMs) every second until it returns false.
export function every(fn) {
  const id = setInterval(() => { if (fn() === false) clearInterval(id); }, 1000);
  fn();
  return id;
}
