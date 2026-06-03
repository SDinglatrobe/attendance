const express = require("express");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const app = express();
app.set("trust proxy", true);

const PORT = process.env.PORT || 3000;
const TIME_ZONE = "Australia/Melbourne";
const FIRST_CLASS_DATE = process.env.FIRST_CLASS_DATE || "2026-07-14"; // Tuesday, Week 1
const OPEN_HOUR = Number(process.env.OPEN_HOUR || 5);   // 05:00 Melbourne time
const CLOSE_HOUR = Number(process.env.CLOSE_HOUR || 17); // 17:00 Melbourne time
const ROSTER_FILES = ["5006.txt", "3CWA.txt"];
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "attendance.json");
const URL_FILE = path.join(__dirname, "url.txt");
const ADMIN_KEY = process.env.ADMIN_KEY || "";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ weeks: {} }, null, 2), "utf8");
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
  ensureDataFile();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
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
  const isOpen = Boolean(isTuesdayFromStart && mel.hour >= OPEN_HOUR && mel.hour < CLOSE_HOUR);

  let statusMessage = "Attendance is closed. Please wait until the next Tuesday session.";
  if (dayDiff < 0) statusMessage = "Attendance has not started yet.";
  else if (!isTuesdayFromStart) statusMessage = "Attendance is only open on Tuesday between 05:00 and 17:00 Melbourne time.";
  else if (mel.hour < OPEN_HOUR) statusMessage = "Attendance is not open yet. It opens at 05:00 Melbourne time.";
  else if (mel.hour >= CLOSE_HOUR) statusMessage = "Attendance for this week is closed. Please wait until next week.";
  else statusMessage = "Attendance is open.";

  return {
    weekNumber,
    sessionId,
    isOpen,
    melbourneTime: mel.display,
    melbourneDate: mel.isoDate,
    statusMessage,
    firstClassDate: FIRST_CLASS_DATE,
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    timeZone: TIME_ZONE
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

function pageTemplate({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --blue:#0a66c2; --dark:#111827; --muted:#6b7280; --border:#e5e7eb; --bg:#f9fafb; --danger:#b91c1c; --ok:#166534; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--dark); }
    .wrap { width:100%; max-width: 480px; margin:0 auto; padding: 22px 16px; }
    .card { background:white; border:1px solid var(--border); border-radius:18px; padding:24px; box-shadow:0 8px 24px rgba(0,0,0,0.06); }
    h1 { font-size: 28px; margin: 0 0 8px; text-align:center; }
    h2 { font-size: 21px; margin: 0 0 14px; }
    p { font-size: 16px; line-height: 1.5; }
    .muted { color: var(--muted); font-size:14px; }
    .status { padding:12px; border-radius:12px; margin:14px 0; font-weight:600; }
    .status.ok { background:#dcfce7; color:var(--ok); }
    .status.bad { background:#fee2e2; color:var(--danger); }
    label { display:block; font-weight:700; margin:18px 0 8px; }
    input { width:100%; font-size:22px; padding:16px; border:1px solid #d1d5db; border-radius:12px; }
    button { width:100%; font-size:20px; font-weight:700; padding:16px; margin-top:16px; border:0; border-radius:12px; background:var(--blue); color:white; cursor:pointer; }
    button:disabled { background:#9ca3af; cursor:not-allowed; }
    .center { text-align:center; }
    .small { font-size:13px; color:var(--muted); }
    a { color:var(--blue); }
    .qr { width:260px; height:260px; max-width:100%; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    td, th { border-bottom:1px solid var(--border); padding:8px; text-align:left; }
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

app.get("/", (req, res) => {
  const session = getSessionInfo();
  const requestedWeek = Number(req.query.week || session.weekNumber || 0);
  const isCurrentWeekLink = !session.weekNumber || requestedWeek === session.weekNumber;
  const canSubmit = session.isOpen && isCurrentWeekLink;

  const statusClass = canSubmit ? "ok" : "bad";
  const statusText = !isCurrentWeekLink
    ? "This QR code is not for the current week. Please scan the current week's QR code."
    : session.statusMessage;

  res.send(pageTemplate({
    title: "Attendance Check",
    body: `
      <h1>Attendance Check</h1>
      <p class="center muted">CSE3CWA / CSE5006</p>
      <div class="status ${statusClass}">${escapeHtml(statusText)}</div>
      <p class="small center">Current server time: ${escapeHtml(session.melbourneTime)}</p>
      <form method="POST" action="/checkin">
        <input type="hidden" name="week" value="${escapeHtml(requestedWeek)}" />
        <label for="studentId">Student ID</label>
        <input id="studentId" name="studentId" inputmode="numeric" autocomplete="off" pattern="[0-9]*" placeholder="Enter your student ID" ${canSubmit ? "required" : "disabled"} />
        <button type="submit" ${canSubmit ? "" : "disabled"}>Submit</button>
      </form>
      <p class="small center">You can submit once only for the current week.</p>
    `
  }));
});

app.post("/checkin", (req, res) => {
  const session = getSessionInfo();
  const requestedWeek = Number(req.body.week || 0);

  if (!session.isOpen) {
    return res.send(pageTemplate({
      title: "Attendance Closed",
      body: `<h1>Attendance Check</h1><div class="status bad">${escapeHtml(session.statusMessage)}</div><p class="center"><a href="/">Back</a></p>`
    }));
  }

  if (requestedWeek !== session.weekNumber) {
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

  ensureDataFile();
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
        <div class="status bad">You have already submitted attendance for ${escapeHtml(session.sessionId)}.</div>
        <p><strong>Student ID:</strong> ${escapeHtml(student.studentCode)}</p>
        <p><strong>Name:</strong> ${escapeHtml(student.fullName)}</p>
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
    submittedAtUtc: nowUtc.toISOString(),
    submittedAtMelbourne: melNow.display,
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || ""
  };

  writeJsonFile(DATA_FILE, data);

  res.send(pageTemplate({
    title: "Check-in Successful",
    body: `
      <h1>签到成功！</h1>
      <div class="status ok">Your attendance has been recorded.</div>
      <p><strong>Student ID:</strong> ${escapeHtml(student.studentCode)}</p>
      <p><strong>Name:</strong> ${escapeHtml(student.fullName)}</p>
      <p><strong>Week:</strong> ${escapeHtml(session.sessionId)}</p>
      <p class="small">Submitted at: ${escapeHtml(melNow.display)}</p>
    `
  }));
});

app.get("/qr", async (req, res) => {
  const session = getSessionInfo();
  const url = getCheckinUrl(req, session);
  const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });

  res.send(pageTemplate({
    title: "Attendance QR Code",
    body: `
      <h1>Attendance QR</h1>
      <p class="center muted">${escapeHtml(session.sessionId || "No active teaching week yet")}</p>
      <div class="center"><img class="qr" src="${qrDataUrl}" alt="Attendance QR Code" /></div>
      <p class="small center">${escapeHtml(url)}</p>
      <div class="status ${session.isOpen ? "ok" : "bad"}">${escapeHtml(session.statusMessage)}</div>
      <p class="small center">Time: ${escapeHtml(session.melbourneTime)}</p>
    `
  }));
});

app.get("/attendance.json", (req, res) => {
  if (ADMIN_KEY && req.query.key !== ADMIN_KEY) {
    return res.status(403).send("Forbidden");
  }
  ensureDataFile();
  res.download(DATA_FILE, "attendance.json");
});

app.get("/admin", (req, res) => {
  if (ADMIN_KEY && req.query.key !== ADMIN_KEY) {
    return res.status(403).send("Forbidden");
  }

  const data = readJsonFile(DATA_FILE, { weeks: {} });
  const rows = [];
  for (const [week, weekData] of Object.entries(data.weeks || {})) {
    for (const rec of Object.values(weekData.records || {})) {
      rows.push(rec);
    }
  }

  const bodyRows = rows.map(r => `
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
      <p><a href="/qr${ADMIN_KEY ? `?key=${encodeURIComponent(ADMIN_KEY)}` : ""}">Current QR code</a></p>
      <p><a href="/attendance.json${ADMIN_KEY ? `?key=${encodeURIComponent(ADMIN_KEY)}` : ""}">Download attendance.json</a></p>
      <table>
        <thead><tr><th>Week</th><th>ID</th><th>Name</th><th>File</th><th>Time</th></tr></thead>
        <tbody>${bodyRows || "<tr><td colspan='5'>No records yet.</td></tr>"}</tbody>
      </table>
    `
  }));
});

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`Attendance system running on port ${PORT}`);
  console.log(`First class date: ${FIRST_CLASS_DATE}`);
  console.log(`Time zone: ${TIME_ZONE}`);
});
