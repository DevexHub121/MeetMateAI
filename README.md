# MeetMate

AI notes for every meeting. MeetMate joins your calls (Google Meet, Zoom, Teams) or
records on-device, transcribes every word with speaker attribution, and emails
everyone the minutes — summary, decisions, action items — automatically.

A standalone multi-tenant SaaS: its own accounts, its own organizations, its own
database. No shared SSO.

## Stack

- Next.js (App Router) · React · Tailwind
- Drizzle ORM on Postgres (Neon HTTP driver)
- Deepgram (transcription) · OpenAI (minutes) · Recall.ai (meeting bot)
- DigitalOcean Spaces / any S3 (recording storage)

## Getting started

1. `cp .env.example .env.local` and fill it in. At minimum:
   - `DATABASE_URL` — a fresh Postgres/Neon database, **separate from anything else**
   - `AUTH_SECRET` — `openssl rand -base64 32`
2. Create the schema:
   ```bash
   npx drizzle-kit migrate      # applies drizzle/0000_meetmate_init.sql
   ```
3. `npm install && npm run dev`

## Auth model

- A **user** signs in with email + password.
- A **company** is an **organization**; the first person to register becomes its admin.
- **Membership** ties them together with an org role (admin or member).
- Every **meeting** belongs to an organization — that's the wall between tenants.
- Signup is OTP-verified; admins invite teammates by email.

The signed session cookie proves identity only; role and membership are read
from the database on every request, so suspending or re-roling a member takes
effect immediately.
