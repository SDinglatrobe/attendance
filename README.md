# LTU Attendance System

Simple Node.js / Express attendance system for CSE3CWA / CSE5006.

## Deploy on Render

Build Command:

```text
npm install
```

Start Command:

```text
npm start
```

## Important files

```text
5006.txt
3CWA.txt
url.txt
data/attendance.json
data/settings.json
```

`url.txt` should contain the public Render URL, for example:

```text
https://attendance-80su.onrender.com
```

## Student page

```text
https://attendance-80su.onrender.com/
```

Students see a mobile-friendly page with only:

```text
Student ID input
Submit button
```

If the student ID does not exist in `5006.txt` or `3CWA.txt`, the system rejects the submission.

Each student can submit once per week/session.

## QR page

```text
https://attendance-80su.onrender.com/qr
```

The QR code points to the current week check-in URL. The URL text is not printed on the QR page.

## Admin mode

Open:

```text
https://attendance-80su.onrender.com/admin
```

Password:

```text
171717
```

Admin mode allows you to:

- show the current QR code
- download `attendance.json`
- turn formal running mode ON/OFF
- clear attendance JSON records and restore original empty data
- view recent attendance records

## Formal running mode

When formal running mode is ON:

- Attendance only works on Tuesday
- Open time: 05:00 Melbourne time
- Close time: 17:00 Melbourne time
- Time zone: Australia/Melbourne
- Daylight saving is handled automatically by Node.js `Intl`

When formal running mode is OFF:

- Test mode is enabled
- You can test submissions anytime
- Time restriction is ignored

## Data warning

This version stores attendance in local JSON files. On Render free services, local files may be lost after redeploy/restart/instance replacement. Download `attendance.json` after each class as backup.
