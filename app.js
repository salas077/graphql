"use strict";

/* =========================================================
   1. SETTINGS
   ========================================================= */
const DOMAIN = "platform.zone01.gr";
const SIGNIN_URL = `https://${DOMAIN}/api/auth/signin`;
const GRAPHQL_URL = `https://${DOMAIN}/api/graphql-engine/v1/graphql`;
const TOKEN_KEY = "jwt";
const SVG_NS = "http://www.w3.org/2000/svg";

/* =========================================================
   2. GRAPHQL QUERIES
   ========================================================= */

// (a) NORMAL query: pick a table and fields, no arguments.
const USER_QUERY = `{
  user {
    id
    login
    attrs
    auditRatio
    totalUp
    totalDown
  }
}`;

// (b) Query WITH ARGUMENTS (where, order_by, variable $type)
// (c) NESTED query: inside the transaction we also request its object.
const TRANSACTIONS_QUERY = `query ($type: String!) {
  transaction(
    where: { type: { _eq: $type } }
    order_by: { createdAt: asc }
  ) {
    amount
    createdAt
    path
    eventId
    object {
      name
      type
    }
  }
}`;

/* =========================================================
   3. HELPER FUNCTIONS
   ========================================================= */
const $ = (id) => document.getElementById(id);

// base64 that also works with Greek/special characters
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

// Reads the middle part (payload) of the JWT
function decodeJwt(token) {
  try {
    let payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    payload += "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function isTokenValid(token) {
  if (!token) return false;
  const payload = decodeJwt(token);
  return payload !== null && payload.exp * 1000 > Date.now();
}

// 51800 -> "51.8 kB", 693000 -> "693 kB" (3 significant digits, like the platform)
function formatXP(amount) {
  if (amount >= 1_000_000) return Number((amount / 1_000_000).toPrecision(3)) + " MB";
  if (amount >= 1000) return Number((amount / 1000).toPrecision(3)) + " kB";
  return Math.round(amount) + " B";
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

/* =========================================================
   4. COMMUNICATION WITH THE SERVER
   ========================================================= */

// Login: Basic auth -> we get a JWT
async function login(identifier, password) {
  let response;
  try {
    response = await fetch(SIGNIN_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${toBase64(`${identifier}:${password}`)}` },
    });
  } catch {
    throw new Error("Cannot reach the server. Check your internet connection.");
  }

  if (!response.ok) {
    throw new Error("Invalid username/email or password.");
  }

  const token = await response.json();
  localStorage.setItem(TOKEN_KEY, token);
}

// Sends any GraphQL query with a Bearer token
async function graphql(query, variables = {}) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors) {
    const message = json.errors[0].message;
    if (message.includes("JWT")) {
      logout("Your session expired. Please sign in again.");
    }
    throw new Error(message);
  }
  return json.data;
}

/* =========================================================
   5. DATA PROCESSING
   ========================================================= */

// Finds the eventId of the main module (div-01), so that the total XP
// matches the platform. Piscine JS belongs to div-01 and counts;
// Piscine Go and other events have their own eventId and are excluded.
function findModuleEventId(transactions) {
  const counts = {};
  for (const t of transactions) {
    const isModuleProject = /^\/[^/]+\/div-01\/[^/]+$/.test(t.path);
    if (isModuleProject && !t.path.includes("piscine") && !t.path.includes("checkpoint")) {
      counts[t.eventId] = (counts[t.eventId] || 0) + 1;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? Number(sorted[0][0]) : null;
}

function onlyEvent(transactions, eventId) {
  if (eventId === null) return transactions;
  return transactions.filter((t) => t.eventId === eventId);
}

function itemName(t) {
  return t.object?.name ?? t.path.split("/").pop();
}

/* =========================================================
   6. PAGE DISPLAY (VIEWS)
   ========================================================= */
function showView(name) {
  $("login-view").hidden = name !== "login";
  $("profile-view").hidden = name !== "profile";
}

function logout(message = "") {
  localStorage.removeItem(TOKEN_KEY);
  // Clear any data left on the page
  ["chart-xp-time", "chart-xp-project", "chart-audits", "recent-xp", "gql-output"]
    .forEach((id) => { $(id).replaceChildren(); });
  showView("login");
  $("login-error").textContent = message;
}

async function showProfile() {
  showView("profile");
  $("profile-status").textContent = "Loading your data...";

  try {
    // Three requests at the same time
    const [userData, xpData, levelData] = await Promise.all([
      graphql(USER_QUERY),
      graphql(TRANSACTIONS_QUERY, { type: "xp" }),
      graphql(TRANSACTIONS_QUERY, { type: "level" }),
    ]);

    const user = userData.user[0];
    const eventId = findModuleEventId(xpData.transaction);
    const xp = onlyEvent(xpData.transaction, eventId);
    const levels = onlyEvent(levelData.transaction, eventId);
    const level = levels.length ? Math.max(...levels.map((t) => t.amount)) : 0;

    renderUser(user, level);
    renderXP(xp);
    renderAudits(user);
    drawXpOverTime(xp);
    drawXpByProject(xp);
    drawAuditDonut(user);

    $("profile-status").textContent = "";
  } catch (error) {
    $("profile-status").textContent = `Could not load data: ${error.message}`;
  }
}

/* =========================================================
   7. THE 3 SECTIONS
   ========================================================= */
function renderUser(user, level) {
  const attrs = user.attrs || {};
  const fullName = `${attrs.firstName ?? ""} ${attrs.lastName ?? ""}`.trim();

  $("user-login").textContent = user.login;
  $("user-name").textContent = fullName || "—";
  $("user-email").textContent = attrs.email ?? "—";
  $("user-id").textContent = user.id;
  $("user-level").textContent = level;
}

function renderXP(transactions) {
  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  $("total-xp").textContent = formatXP(total);
  $("total-xp-exact").textContent = `${total.toLocaleString("en-US")} XP in total`;

  const list = $("recent-xp");
  list.replaceChildren();
  const latest = transactions.slice(-5).reverse();
  for (const t of latest) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    const amount = document.createElement("span");
    name.textContent = itemName(t);
    amount.textContent = `+${formatXP(t.amount)}`;
    amount.className = "up";
    li.append(name, amount);
    list.append(li);
  }
}

function renderAudits(user) {
  const ratio = Number(user.auditRatio ?? 0);
  $("audit-ratio").textContent = ratio.toFixed(1);
  $("audit-ratio").className = ratio >= 1 ? "big up" : "big down";
  $("audit-message").textContent = ratio >= 1 ? "Great, keep auditing!" : "Do more audits to raise your ratio.";
  $("audit-done").textContent = formatXP(user.totalUp ?? 0);
  $("audit-received").textContent = formatXP(user.totalDown ?? 0);
}

/* =========================================================
   8. SVG CHARTS
   ========================================================= */

// Creates an SVG element with attributes and (optionally) adds it to a parent
function svgEl(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (parent) parent.appendChild(el);
  return el;
}

function svgText(parent, x, y, text, attrs = {}) {
  const el = svgEl("text", { x, y, ...attrs }, parent);
  el.textContent = text;
  return el;
}

function addTooltip(el, text) {
  svgEl("title", {}, el).textContent = text;
}

// Chart 1: LINE CHART — cumulative XP over time
function drawXpOverTime(transactions) {
  const box = $("chart-xp-time");
  box.replaceChildren();
  if (!transactions.length) { box.textContent = "No XP yet."; return; }

  const W = 700, H = 300;
  const P = { top: 20, right: 20, bottom: 40, left: 70 };

  let running = 0;
  const points = transactions.map((t) => {
    running += t.amount;
    return { time: new Date(t.createdAt).getTime(), total: running, t };
  });

  const minT = points[0].time;
  const maxT = points[points.length - 1].time;
  const maxY = running || 1;

  const x = (time) => P.left + (maxT === minT ? 0.5 : (time - minT) / (maxT - minT)) * (W - P.left - P.right);
  const y = (value) => H - P.bottom - (value / maxY) * (H - P.top - P.bottom);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "XP over time" }, box);

  // Horizontal lines + labels on the Y axis
  for (let i = 0; i <= 4; i++) {
    const value = (maxY * i) / 4;
    svgEl("line", { x1: P.left, x2: W - P.right, y1: y(value), y2: y(value), class: "grid-line" }, svg);
    svgText(svg, P.left - 8, y(value) + 4, formatXP(value), { class: "axis-label", "text-anchor": "end" });
  }

  // Dates on the X axis
  svgText(svg, P.left, H - 12, formatDate(minT), { class: "axis-label", "text-anchor": "start" });
  svgText(svg, W - P.right, H - 12, formatDate(maxT), { class: "axis-label", "text-anchor": "end" });

  // Filled area under the line + the line itself
  const coords = points.map((p) => `${x(p.time)},${y(p.total)}`);
  svgEl("path", { d: `M ${x(minT)},${y(0)} L ${coords.join(" L ")} L ${x(maxT)},${y(0)} Z`, class: "area" }, svg);
  svgEl("polyline", { points: coords.join(" "), class: "line" }, svg);

  // Dots with tooltip (hover)
  for (const p of points) {
    const dot = svgEl("circle", { cx: x(p.time), cy: y(p.total), r: 5, class: "point" }, svg);
    addTooltip(dot, `${itemName(p.t)}: +${formatXP(p.t.amount)}\nTotal: ${formatXP(p.total)}\n${formatDate(p.time)}`);
  }
}

// Chart 2: BAR CHART — XP per project (top 8)
function drawXpByProject(transactions) {
  const box = $("chart-xp-project");
  box.replaceChildren();
  if (!transactions.length) { box.textContent = "No XP yet."; return; }

  const totals = {};
  for (const t of transactions) {
    const name = itemName(t);
    totals[name] = (totals[name] || 0) + t.amount;
  }
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const W = 500, rowH = 34, labelW = 140, valueW = 70;
  const H = top.length * rowH + 10;
  const maxValue = top[0][1];
  const barMax = W - labelW - valueW;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "XP by project" }, box);

  top.forEach(([name, value], i) => {
    const yPos = i * rowH + 5;
    const width = Math.max((value / maxValue) * barMax, 2);
    const shortName = name.length > 18 ? name.slice(0, 17) + "…" : name;

    svgText(svg, labelW - 10, yPos + 19, shortName, { class: "bar-label", "text-anchor": "end" });
    const bar = svgEl("rect", { x: labelW, y: yPos + 4, width, height: rowH - 12, rx: 4, class: "bar" }, svg);
    addTooltip(bar, `${name}: ${formatXP(value)}`);
    svgText(svg, labelW + width + 8, yPos + 19, formatXP(value), { class: "bar-value" });
  });
}

// Chart 3: DONUT — audits done vs received
function drawAuditDonut(user) {
  const box = $("chart-audits");
  box.replaceChildren();

  const done = user.totalUp ?? 0;
  const received = user.totalDown ?? 0;
  const total = done + received;

  const size = 260, c = size / 2, r = 90;
  const circumference = 2 * Math.PI * r;
  const doneLength = total ? (done / total) * circumference : 0;

  const svg = svgEl("svg", { viewBox: `0 0 ${size} ${size}`, class: "chart", role: "img", "aria-label": "Audit ratio" }, box);
  svgEl("circle", { cx: c, cy: c, r, class: "donut-bg" }, svg);

  if (total) {
    const upArc = svgEl("circle", {
      cx: c, cy: c, r, class: "donut-up",
      "stroke-dasharray": `${doneLength} ${circumference - doneLength}`,
      transform: `rotate(-90 ${c} ${c})`,
    }, svg);
    addTooltip(upArc, `Done: ${formatXP(done)}`);

    const downArc = svgEl("circle", {
      cx: c, cy: c, r, class: "donut-down",
      "stroke-dasharray": `${circumference - doneLength} ${doneLength}`,
      "stroke-dashoffset": -doneLength,
      transform: `rotate(-90 ${c} ${c})`,
    }, svg);
    addTooltip(downArc, `Received: ${formatXP(received)}`);
  }

  svgText(svg, c, c + 8, Number(user.auditRatio ?? 0).toFixed(1), { class: "donut-center", "text-anchor": "middle" });
  svgText(svg, c, c + 30, "audit ratio", { class: "donut-sub", "text-anchor": "middle" });
}

/* =========================================================
   9. EVENTS (what happens when the user does something)
   ========================================================= */
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); // don't reload the page

  const identifier = $("identifier").value.trim();
  const password = $("password").value;
  const errorBox = $("login-error");
  const button = $("login-btn");

  errorBox.textContent = "";
  if (!identifier || !password) {
    errorBox.textContent = "Please fill in both fields.";
    return;
  }

  button.disabled = true;
  button.textContent = "Signing in...";
  try {
    await login(identifier, password);
    $("login-form").reset();
    await showProfile();
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});

$("logout-btn").addEventListener("click", () => logout());

// Bonus: Mini GraphiQL
// Default example query (short, no personal data)
$("gql-query").value = `{
  user {
    id
    login
    auditRatio
  }
}`;
$("gql-run").addEventListener("click", async () => {
  const output = $("gql-output");
  output.textContent = "Running...";
  try {
    const data = await graphql($("gql-query").value);
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    output.textContent = `Error: ${error.message}`;
  }
});

/* =========================================================
   10. STARTUP
   ========================================================= */
if (isTokenValid(getToken())) {
  showProfile();
} else {
  localStorage.removeItem(TOKEN_KEY);
  showView("login");
}
