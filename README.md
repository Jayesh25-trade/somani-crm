# Dr Somani's Homoeopathy — Patient Reminder CRM

Patient management and medicine-refill reminders for the Pune and Jalgaon clinics.
Plain Node.js (no dependencies), vanilla JS front end, JSON file storage.

## Run it locally

Requires Node.js 18+.

```bash
node scripts/create-admin.js admin@drsomanihomoeopathy.com '<password>'   # once
npm start                                                                 # http://localhost:4180
```

On first start, `data/db.json` is created with **sample data** (≈6 months, ~800 patients, flagged `sample: true`).
Remove it any time from **Settings → Remove sample patients**. `PORT=xxxx npm start` changes the port.

## How reminders work

- Each patient gets a **treatment plan**: medicine every **14 days × 12 intervals** or **28 days × 6 intervals** (≈ 6 months), chosen when adding the patient.
- **One reminder on each refill day.** Notation **14DR3** = 14-day plan, reminder 3, day 42.
- The **Reminders** board (kanban by day; day-tabs on phones) shows what to send today. Tap the WhatsApp button → pick a message (English / Marathi / Hindi …) → *Send on WhatsApp & mark sent*. Sent tiles turn green and stay on their day; missed ones turn red.
- **Calendar** (month view) and **Timeline** (patients × days grid) show the same reminders.
- Doctors: Dr Kushal Somani (default for Pune), Dr Antim Somani (default for Jalgaon) — changeable per patient.
- Duplicate patient names are rejected.

## Project layout

| Path | What it is |
|---|---|
| `server.js` | HTTP server, login (scrypt hash, HttpOnly session cookie, lockout), static files |
| `store.js` | Data store (`data/db.json`) and all `/api/*` routes; per-patient patch responses, `?since=rev` delta sync |
| `seed.js` | Sample-data simulation (first run only) |
| `scripts/create-admin.js` | Creates the admin login |
| `public/login.*` | Sign-in page |
| `public/app.*` | The app (board, calendar, timeline, patients, settings) |
| `public/tokens.css` | Brand colours & fonts (light/dark) |
| `public/brand/` | Clinic logos |

## Data model (short)

- `patients[]` — `{ id, regNo (JAL-0001 / PUN-0001), name, phone, location, doctor, … }`
- `courses[]` — a treatment plan: `{ patientId, startDate, days, intervals, dueDate, plan: [{ id: 'r1', offset, templateId }…], reminders: [{ stepId, at, by, templateId, channel }], status }`
  Reminder *k* is due on `dueDate + plan[k].offset` (= start + days × k).
- `settings` — message templates, plan defaults, default doctor per clinic, clinic names/phones.

## Deploying

Run behind HTTPS (reverse proxy) with `NODE_ENV=production` (secure cookies + HSTS) and `TRUST_PROXY=1`
so login rate-limiting sees the real client IP. Back up `data/` regularly.
