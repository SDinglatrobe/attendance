# LTU Attendance System

Copyright (C) 2026 Dr Shuo Ding <shuoding@outlook.com>

This project is licensed under the GNU Affero General Public License version 3.
Any copy, redistribution or modified distribution must preserve the original
author and copyright information. See [LICENSE](LICENSE).

A simple Node.js attendance check-in system. Students open
a page, type their student ID, and the app records one attendance per student
per teaching week. It is intentionally small so it is easy to read and deploy.

## Features

- Reads student rosters from `5006.txt` and `3CWA.txt`
- Week 1 starts on Tuesday 2026-07-14 (configurable)
- In formal mode, attendance is open only on Tuesday 05:00–17:00 Melbourne time
- A test mode (default) ignores the Tuesday/time restriction so you can practise
- Weekly QR code that encodes the current week via the `week` URL parameter
- Students only enter their student ID and submit
- The student ID must exist in the roster files
- One submission per student per week
- Attendance records are stored in `data/attendance.json`
- Mobile-friendly pages

## Requirements

- Node.js 18 or newer (see `engines` in `package.json`)
- npm (comes with Node.js)

## Project structure

```text
package.json        Project metadata, dependencies and the start script
server.js           The whole application (Express server + routes + pages)
url.txt             Optional fixed base URL used when building the QR link
5006.txt            CSE5006 roster (tab-separated)
3CWA.txt            CSE3CWA roster (tab-separated)
data/attendance.json  Where check-ins are stored at runtime
LICENSE             AGPL-3.0 licence text
```

## Run locally

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open the app in a browser
#    http://localhost:3000
```

The server prints the port it is listening on. It listens on `process.env.PORT`
if that is set (for example on a host such as Render), and otherwise falls back
to port `3000`.

## Pages and routes

| Route               | Method | Purpose                                             |
| ------------------- | ------ | --------------------------------------------------- |
| `/`                 | GET    | Student check-in page (enter student ID and submit) |
| `/checkin`          | POST   | Records the attendance submission                   |
| `/qr`               | GET    | Shows the QR code for the current week              |
| `/admin`            | GET    | Admin dashboard (requires admin login)              |
| `/admin/login`      | POST   | Logs in to admin mode and sets the admin cookie     |
| `/admin/formal-mode`| POST   | Turns formal Tuesday/time mode on or off            |
| `/admin/reset`      | POST   | Clears all attendance records (type `YES`)          |
| `/attendance.json`  | GET    | Downloads the records file (requires admin login)   |

## Admin access

Admin mode is protected by a password, read from the environment variable
`ADMIN_PASSWORD`. If it is not set, the code falls back to a default value of
`171717` for convenience during local testing.

You log in through a form, not a URL key:

1. Open `/admin`.
2. Enter the admin password on the login page and submit.
3. The server sets an `HttpOnly` cookie named `attendance_admin`, and you stay
   logged in for 24 hours.

To set your own password (always do this on a public server), provide the
environment variable before starting the app:

```bash
# Local example
ADMIN_PASSWORD=your-secret npm start
```

```text
# On a managed host (for example Render), add an environment variable:
ADMIN_PASSWORD = your-secret
```

> Security note: do not leave the default password on a public deployment, and
> never commit a real password to a public repository.

## Configuration (environment variables)

| Variable           | Default              | Meaning                                        |
| ------------------ | -------------------- | ---------------------------------------------- |
| `PORT`             | `3000`               | Port the server listens on                     |
| `ADMIN_PASSWORD`   | `171717`             | Password for the admin login form              |
| `FIRST_CLASS_DATE` | `2026-07-14`         | Date of the Tuesday in Week 1                  |
| `OPEN_HOUR`        | `5`                  | Hour attendance opens in formal mode (Melbourne) |
| `CLOSE_HOUR`       | `17`                 | Hour attendance closes in formal mode (Melbourne) |

## Setup on Render

```text
Environment:    Node
Build Command:  npm install
Start Command:  npm start
```

Optionally set `ADMIN_PASSWORD` (and `FIRST_CLASS_DATE`) in the Render
environment variables. After deployment, you may edit `url.txt` and replace the
placeholder with your Render app URL so the QR code uses a fixed base address,
then commit and push the change to GitHub.

## Important note about JSON storage

This version stores attendance records in a local JSON file (`data/attendance.json`)
on the running server. On free or stateless hosting platforms, local files can be
lost after a redeploy, restart, or instance replacement. Download
`attendance.json` from the admin page after each class as a backup.

For long-term production use, store records in a database or on a persistent disk
instead of a runtime file.
