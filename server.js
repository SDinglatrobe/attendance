/*
 * LTU Attendance System
 * Copyright (C) 2026 Dr Shuo Ding <shuoding@outlook.com>
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License version 3.
 * Any copy or distribution must preserve this original author and copyright notice.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const app = express();
app.set("trust proxy", true);

const PORT = process.env.PORT || 3000;
const TIME_ZONE = "Australia/Melbourne";
const FIRST_CLASS_DATE = process.env.FIRST_CLASS_DATE || "2026-07-14"; // Tuesday, Week 1
const OPEN_HOUR = Number(process.env.OPEN_HOUR || 5);     // 05:00 Melbourne time
const CLOSE_HOUR = Number(process.env.CLOSE_HOUR || 17);  // 17:00 Melbourne time
const ROSTER_FILES = ["5006.txt", "3CWA.txt"];
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "attendance.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const URL_FILE = path.join(__dirname, "url.txt");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "12345678";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ weeks: {} }, null, 2), "utf8");
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ formalMode: false }, null, 2), "utf8");
  }
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text || JSON.stringify(fallback));
  } catch (err) {
    console.error("Failed to read JSON:", err);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureDataFiles();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function getSettings() {
  ensureDataFiles();
  const settings = readJsonFile(SETTINGS_FILE, { formalMode: false });
  return { formalMode: Boolean(settings.formalMode) };
}

function setFormalMode(value) {
  writeJsonFile(SETTINGS_FILE, { formalMode: Boolean(value) });
}

function resetAttendanceData() {
  writeJsonFile(DATA_FILE, { weeks: {} });
}

function normalizeHeaderName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseRosterFile(filename) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) return [];

  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map(normalizeHeaderName);
  const sourceFile = filename;

  const students = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(delimiter);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = String(parts[i] || "").trim();
    });

    const studentCode = String(row.student_code || row.student_id || "").replace(/\D/g, "");
    if (!studentCode) continue;

    const lastName = row.last_name || "";
    const firstName = row.first_name || "";
    const courseFile = filename.replace(/\.txt$/i, "");

    students.push({
      studentCode,
      lastName,
      firstName,
      fullName: `${lastName} ${firstName}`.trim(),
      activityGroup: row.activity_group || "",
      activityCode: row.activity_code || "",
      course: row.course || "",
      sourceFile,
      courseFile
    });
  }
  return students;
}

function loadStudents() {
  const all = [];
  for (const file of ROSTER_FILES) {
    all.push(...parseRosterFile(file));
  }
  return all;
}

function getStudentByCode(studentCode) {
  const code = String(studentCode || "").replace(/\D/g, "");
  return loadStudents().find(s => s.studentCode === code) || null;
}

function getMelbourneParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = {};
  for (const item of fmt.formatToParts(date)) {
    if (item.type !== "literal") parts[item.type] = item.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    display: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} Melbourne time`
  };
}

function daysBetweenLocalDates(aYYYYMMDD, bParts) {
  const [ay, am, ad] = aYYYYMMDD.split("-").map(Number);
  const aUTC = Date.UTC(ay, am - 1, ad);
  const bUTC = Date.UTC(bParts.year, bParts.month - 1, bParts.day);
  return Math.floor((bUTC - aUTC) / 86400000);
}

function getSessionInfo(date = new Date()) {
  const mel = getMelbourneParts(date);
  const dayDiff = daysBetweenLocalDates(FIRST_CLASS_DATE, mel);

  let weekNumber = null;
  let sessionId = null;

  if (dayDiff >= 0) {
    weekNumber = Math.floor(dayDiff / 7) + 1;
    sessionId = `week-${String(weekNumber).padStart(2, "0")}`;
  }

  const isTuesdayFromStart = dayDiff >= 0 && dayDiff % 7 === 0;
  const isTimeOpen = Boolean(isTuesdayFromStart && mel.hour >= OPEN_HOUR && mel.hour < CLOSE_HOUR);

  let statusMessage = "Attendance is closed. Please wait until the next Tuesday session.";
  if (dayDiff < 0) statusMessage = "Attendance has not started yet.";
  else if (!isTuesdayFromStart) statusMessage = "Attendance is only open on Tuesday between 05:00 and 17:00 Melbourne time.";
  else if (mel.hour < OPEN_HOUR) statusMessage = "Attendance is not open yet. It opens at 05:00 Melbourne time.";
  else if (mel.hour >= CLOSE_HOUR) statusMessage = "Attendance for this week is closed. Please wait until next week.";
  else statusMessage = "Attendance is open.";

  return {
    weekNumber,
    sessionId,
    isTimeOpen,
    melbourneTime: mel.display,
    melbourneDate: mel.isoDate,
    statusMessage,
    firstClassDate: FIRST_CLASS_DATE,
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    timeZone: TIME_ZONE
  };
}

function getEffectiveSessionInfo(req) {
  const baseSession = getSessionInfo();
  const settings = getSettings();
  const requestedWeek = Number((req.query && req.query.week) || (req.body && req.body.week) || baseSession.weekNumber || 0);

  if (settings.formalMode) {
    return {
      ...baseSession,
      formalMode: true,
      weekNumber: baseSession.weekNumber,
      sessionId: baseSession.sessionId,
      requestedWeek,
      isOpen: baseSession.isTimeOpen,
      isCurrentWeekLink: Boolean(baseSession.weekNumber && requestedWeek === baseSession.weekNumber)
    };
  }

  // Test mode: ignore Tuesday/time restriction. Useful before the semester starts or outside Tuesday 05:00-17:00.
  const testWeek = requestedWeek || baseSession.weekNumber || 0;
  const testSessionId = testWeek > 0 ? `week-${String(testWeek).padStart(2, "0")}` : "test-week";
  return {
    ...baseSession,
    formalMode: false,
    weekNumber: testWeek,
    sessionId: testSessionId,
    requestedWeek: testWeek,
    isOpen: true,
    isCurrentWeekLink: true,
    statusMessage: "Test mode is open. Formal Tuesday time restriction is currently OFF."
  };
}

function readBaseUrl(req) {
  try {
    if (fs.existsSync(URL_FILE)) {
      const value = fs.readFileSync(URL_FILE, "utf8").trim();
      if (value && !value.includes("YOUR-RENDER-APP-URL")) return value.replace(/\/$/, "");
    }
  } catch {}
  return `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
}

function getCheckinUrl(req, sessionInfo) {
  const base = readBaseUrl(req);
  const week = sessionInfo.weekNumber || 0;
  return `${base}/?week=${encodeURIComponent(week)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  header.split(";").forEach(part => {
    const index = part.indexOf("=");
    if (index > -1) {
      const key = part.slice(0, index).trim();
      const val = part.slice(index + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  });
  return cookies;
}

function isAdmin(req) {
  const cookies = parseCookies(req);
  return cookies.attendance_admin === ADMIN_PASSWORD;
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.status(401).send(adminLoginPage("Please enter the admin password."));
  return false;
}

function pageTemplate({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --blue:#0a66c2; --dark:#111827; --muted:#6b7280; --border:#e5e7eb; --bg:#f9fafb; --danger:#b91c1c; --ok:#166534; --warn:#92400e; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--dark); }
    .wrap { width:100%; max-width: 520px; margin:0 auto; padding: 22px 16px; }
    .card { background:white; border:1px solid var(--border); border-radius:18px; padding:24px; box-shadow:0 8px 24px rgba(0,0,0,0.06); }
    h1 { font-size: 28px; margin: 0 0 8px; text-align:center; }
    h2 { font-size: 21px; margin: 0 0 14px; }
    p { font-size: 16px; line-height: 1.5; }
    .muted { color: var(--muted); font-size:14px; }
    .status { padding:12px; border-radius:12px; margin:14px 0; font-weight:600; }
    .status.ok { background:#dcfce7; color:var(--ok); }
    .status.bad { background:#fee2e2; color:var(--danger); }
    .status.warn { background:#fef3c7; color:var(--warn); }
    label { display:block; font-weight:700; margin:18px 0 8px; }
    input { width:100%; font-size:22px; padding:16px; border:1px solid #d1d5db; border-radius:12px; }
    button { width:100%; font-size:20px; font-weight:700; padding:16px; margin-top:16px; border:0; border-radius:12px; background:var(--blue); color:white; cursor:pointer; }
    button.secondary { background:#374151; }
    button.danger { background:#b91c1c; }
    button:disabled { background:#9ca3af; cursor:not-allowed; }
    .center { text-align:center; }
    .small { font-size:13px; color:var(--muted); }
    a { color:var(--blue); }
    .qr { width:280px; height:280px; max-width:100%; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    td, th { border-bottom:1px solid var(--border); padding:8px; text-align:left; }
    .admin-actions { display:grid; gap:12px; margin:16px 0; }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="card">
      ${body}
    </div>
  </main>
</body>
</html>`;
}

function adminLoginPage(message = "") {
  return pageTemplate({
    title: "Admin Login",
    body: `
      <h1>Admin Mode</h1>
      ${message ? `<div class="status warn">${escapeHtml(message)}</div>` : ""}
      <form method="POST" action="/admin/login">
        <label for="password">Admin password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Enter Admin Mode</button>
      </form>
    `
  });
}

app.get("/", (req, res) => {
  const session = getEffectiveSessionInfo(req);
  const canSubmit = session.isOpen && session.isCurrentWeekLink;

  let statusText = session.statusMessage;
  if (session.formalMode && !session.isCurrentWeekLink) {
    statusText = "This QR code is not for the current week. Please scan the current week's QR code.";
  }

  const statusClass = canSubmit ? (session.formalMode ? "ok" : "warn") : "bad";
  const inputDisabled = canSubmit ? "" : "disabled";
  const submitText = canSubmit ? "Submit" : "Time closed";

  res.send(pageTemplate({
    title: "Attendance Check",
    body: `
      <h1>Attendance Check</h1>
      <p class="center muted">CSE3CWA / CSE5006</p>
      <div class="status ${statusClass}">${escapeHtml(statusText)}</div>
      <p class="small center">Current server time: ${escapeHtml(session.melbourneTime)}</p>
      <form method="POST" action="/checkin">
        <input type="hidden" name="week" value="${escapeHtml(session.requestedWeek || session.weekNumber || 0)}" />
        <label for="studentId">Student ID</label>
        <input id="studentId" name="studentId" inputmode="numeric" autocomplete="off" pattern="[0-9]*" placeholder="Enter your student ID" ${canSubmit ? "required" : inputDisabled} />
        <button type="submit" ${canSubmit ? "" : "disabled"}>${escapeHtml(submitText)}</button>
      </form>
      <p class="small center">You can submit once only for the current week.</p>
    `
  }));
});

app.post("/checkin", (req, res) => {
  const session = getEffectiveSessionInfo(req);
  const requestedWeek = Number(req.body.week || 0);

  if (!session.isOpen) {
    return res.send(pageTemplate({
      title: "Attendance Closed",
      body: `<h1>Attendance Check</h1><div class="status bad">${escapeHtml(session.statusMessage)}</div><p class="center"><a href="/">Back</a></p>`
    }));
  }

  if (session.formalMode && requestedWeek !== session.weekNumber) {
    return res.send(pageTemplate({
      title: "Invalid QR Code",
      body: `<h1>Invalid QR Code</h1><div class="status bad">This QR code is not for the current week. Please scan the current QR code.</div><p class="center"><a href="/">Back</a></p>`
    }));
  }

  const studentId = String(req.body.studentId || "").replace(/\D/g, "");

  if (!/^\d{6,12}$/.test(studentId)) {
    return res.send(pageTemplate({
      title: "Invalid Student ID",
      body: `<h1>Invalid Student ID</h1><div class="status bad">Please enter a valid student ID.</div><p class="center"><a href="/">Back</a></p>`
    }));
  }

  const student = getStudentByCode(studentId);

  if (!student) {
    return res.send(pageTemplate({
      title: "Student Not Found",
      body: `<h1>Student Not Found</h1><div class="status bad">Student ID ${escapeHtml(studentId)} does not exist in the class roster.</div><p class="center"><a href="/">Back</a></p>`
    }));
  }

  ensureDataFiles();
  const data = readJsonFile(DATA_FILE, { weeks: {} });
  if (!data.weeks) data.weeks = {};
  if (!data.weeks[session.sessionId]) {
    data.weeks[session.sessionId] = {
      weekNumber: session.weekNumber,
      sessionId: session.sessionId,
      melbourneDate: session.melbourneDate,
      records: {}
    };
  }

  const records = data.weeks[session.sessionId].records;

  if (records[studentId]) {
    return res.send(pageTemplate({
      title: "Already Submitted",
      body: `
        <h1>Already Submitted</h1>
        <div class="status warn">You have already submitted attendance for ${escapeHtml(session.sessionId)}.</div>
        <p><strong>Student ID:</strong> ${escapeHtml(student.studentCode)}</p>
        <p><strong>Name:</strong> ${escapeHtml(student.fullName)}</p>
        <a href="/"><button type="button">Back to Main Page</button></a>
      `
    }));
  }

  const nowUtc = new Date();
  const melNow = getMelbourneParts(nowUtc);

  records[studentId] = {
    studentCode: student.studentCode,
    lastName: student.lastName,
    firstName: student.firstName,
    fullName: student.fullName,
    activityGroup: student.activityGroup,
    activityCode: student.activityCode,
    course: student.course,
    sourceFile: student.sourceFile,
    courseFile: student.courseFile,
    weekNumber: session.weekNumber,
    sessionId: session.sessionId,
    formalMode: session.formalMode,
    submittedAtUtc: nowUtc.toISOString(),
    submittedAtMelbourne: melNow.display,
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || ""
  };

  writeJsonFile(DATA_FILE, data);

  res.send(pageTemplate({
    title: "Check-in Successful",
    body: `
      <h1>Check-in Successful</h1>
      <div class="status ok">Your attendance has been recorded successfully.</div>
      <p><strong>Student ID:</strong> ${escapeHtml(student.studentCode)}</p>
      <p><strong>Name:</strong> ${escapeHtml(student.fullName)}</p>
      <p><strong>Week:</strong> ${escapeHtml(session.sessionId)}</p>
      <p class="small">Submitted at: ${escapeHtml(melNow.display)}</p>
      <button type="button" onclick="window.close(); setTimeout(function(){ window.location.href='/'; }, 250);">Close Page</button>
      <a href="/"><button type="button" class="secondary">Back to Main Page</button></a>
      <p class="small center">If the page does not close automatically, please close this browser tab manually.</p>
    `
  }));
});

app.get("/qr", async (req, res) => {
  const session = getEffectiveSessionInfo(req);
  const url = getCheckinUrl(req, session);
  const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });

  res.send(pageTemplate({
    title: "Attendance QR Code",
    body: `
      <h1>Attendance QR</h1>
      <p class="center muted">${escapeHtml(session.sessionId || "No active teaching week yet")}</p>
      <div class="center"><img class="qr" src="${qrDataUrl}" alt="Attendance QR Code" /></div>
      <div class="status ${session.isOpen ? (session.formalMode ? "ok" : "warn") : "bad"}">${escapeHtml(session.statusMessage)}</div>
      <p class="small center">Time: ${escapeHtml(session.melbourneTime)}</p>
    `
  }));
});

app.get("/attendance.json", (req, res) => {
  if (!requireAdmin(req, res)) return;
  ensureDataFiles();
  res.download(DATA_FILE, "attendance.json");
});

app.get("/admin", (req, res) => {
  if (!isAdmin(req)) {
    return res.send(adminLoginPage());
  }
  return renderAdminPage(req, res, "");
});

app.post("/admin/login", (req, res) => {
  const password = String(req.body.password || "");
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).send(adminLoginPage("Wrong password."));
  }
  res.setHeader("Set-Cookie", `attendance_admin=${encodeURIComponent(ADMIN_PASSWORD)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  return res.redirect("/admin");
});

app.post("/admin/formal-mode", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const action = String(req.body.action || "");
  setFormalMode(action === "on");
  return renderAdminPage(req, res, action === "on" ? "Formal running mode is ON." : "Formal running mode is OFF. Test mode is enabled.");
});

app.post("/admin/reset", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const confirm = String(req.body.confirm || "").trim();
  if (confirm !== "YES") {
    return renderAdminPage(req, res, "Reset cancelled. Type YES to confirm reset.");
  }
  resetAttendanceData();
  return renderAdminPage(req, res, "Attendance JSON has been reset to original empty data.");
});

function renderAdminPage(req, res, message = "") {
  const settings = getSettings();
  const session = getEffectiveSessionInfo(req);
  const data = readJsonFile(DATA_FILE, { weeks: {} });
  const rows = [];
  for (const [week, weekData] of Object.entries(data.weeks || {})) {
    for (const rec of Object.values(weekData.records || {})) rows.push(rec);
  }

  rows.sort((a, b) => String(b.submittedAtUtc || "").localeCompare(String(a.submittedAtUtc || "")));

  const bodyRows = rows.slice(0, 100).map(r => `
    <tr>
      <td>${escapeHtml(r.sessionId)}</td>
      <td>${escapeHtml(r.studentCode)}</td>
      <td>${escapeHtml(r.fullName)}</td>
      <td>${escapeHtml(r.sourceFile)}</td>
      <td>${escapeHtml(r.submittedAtMelbourne)}</td>
    </tr>
  `).join("");

  res.send(pageTemplate({
    title: "Attendance Admin",
    body: `
      <h1>Attendance Admin</h1>
      ${message ? `<div class="status ok">${escapeHtml(message)}</div>` : ""}
      <div class="status ${settings.formalMode ? "ok" : "warn"}">
        Formal running mode: ${settings.formalMode ? "ON" : "OFF / TEST MODE"}
      </div>
      <p class="small center">Current Melbourne time: ${escapeHtml(session.melbourneTime)}</p>
      <p class="small center">Current session: ${escapeHtml(session.sessionId || "none")}</p>

      <div class="admin-actions">
        <a href="/qr"><button type="button">Show current QR code</button></a>
        <a href="/attendance.json"><button type="button" class="secondary">Download attendance.json</button></a>
      </div>

      <h2>Formal running mode</h2>
      <p class="small">When formal running mode is ON, check-in only works on Tuesday 05:00-17:00 Melbourne time. When OFF, you can test anytime.</p>
      <form method="POST" action="/admin/formal-mode">
        <button name="action" value="on" type="submit">Open formal running mode</button>
        <button name="action" value="off" type="submit" class="secondary">Close formal running mode / test anytime</button>
      </form>

      <h2>Reset attendance JSON</h2>
      <p class="small">This clears all attendance records and restores data/attendance.json to empty original data. Students remain in 5006.txt and 3CWA.txt.</p>
      <form method="POST" action="/admin/reset">
        <label for="confirm">Type YES to confirm reset</label>
        <input id="confirm" name="confirm" placeholder="YES" />
        <button type="submit" class="danger">Clear JSON attendance records</button>
      </form>

      <h2>Recent records</h2>
      <table>
        <thead><tr><th>Week</th><th>ID</th><th>Name</th><th>File</th><th>Time</th></tr></thead>
        <tbody>${bodyRows || "<tr><td colspan='5'>No records yet.</td></tr>"}</tbody>
      </table>
    `
  }));
}

app.listen(PORT, () => {
  ensureDataFiles();
  console.log(`Attendance system running on port ${PORT}`);
  console.log(`First class date: ${FIRST_CLASS_DATE}`);
  console.log(`Time zone: ${TIME_ZONE}`);
});
