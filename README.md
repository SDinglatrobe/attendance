# LTU Attendance System

A simple Node.js attendance check-in system for CSE3CWA / CSE5006.

## Features

- Reads student rosters from `5006.txt` and `3CWA.txt`
- Week 1 starts on Tuesday 2026-07-14
- Attendance is open only on Tuesday 05:00-17:00 Melbourne time
- QR code changes by week using the `week` URL variable
- Students only enter their student ID and submit
- Student ID must exist in the roster files
- One submission per student per week
- Attendance records are stored in `data/attendance.json`
- Mobile-friendly page

## Files

```text
package.json
server.js
url.txt
5006.txt
3CWA.txt
data/attendance.json
```

## Setup on Render

Use these settings:

```text
Build Command: npm install
Start Command: npm start
```

After deployment, edit `url.txt` and replace the placeholder with your Render app URL, for example:

```text
https://attendance-demo.onrender.com
```

Commit and push the change to GitHub.

## URLs

Student check-in page:

```text
/
```

Weekly QR code page:

```text
/qr
```

Admin page:

```text
/admin
```

Download JSON:

```text
/attendance.json
```

## Optional Admin Key

In Render environment variables, you can set:

```text
ADMIN_KEY=your-secret-key
```

Then use:

```text
/admin?key=your-secret-key
/attendance.json?key=your-secret-key
```

## Important Note About JSON Storage

This version stores attendance records in a local JSON file on the running server.
On free hosting platforms, local files may be lost after redeploys, restarts, or instance replacement.
Download `attendance.json` after each class as a backup.

For long-term production use, use a database or persistent disk.
