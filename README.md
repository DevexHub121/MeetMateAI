# MeetMate

AI notes for every meeting. MeetMate joins your calls (Google Meet, Zoom, Teams) or
records on-device, transcribes every word with speaker attribution, and emails
everyone the minutes — summary, decisions, action items — automatically.

A standalone multi-tenant SaaS: its own accounts, its own organizations, its own
database. No shared SSO.

## Stack

- Next.js (App Router) · React · Tailwind
- Drizzle ORM on Postgres (Neon HTTP driver)
- Deepgram (transcription) · Ollama or OpenAI (minutes) · Recall.ai (meeting bot)
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

## Meeting minutes model

Minutes use OpenAI automatically when `OPENAI_API_KEY` is configured. Without
that key, they use Ollama. To use the local model, install
[Ollama](https://ollama.com/download), start its service, and download the
default model:

```bash
ollama pull qwen2.5:7b
```

The app uses `http://127.0.0.1:11434` by default. Configure `OLLAMA_BASE_URL`
if Ollama runs on another host, and `OLLAMA_MODEL` to select another installed
model. Set `MINUTES_PROVIDER=openai` or `MINUTES_PROVIDER=ollama` to choose a
provider explicitly. Set `MINUTES_PROVIDER=demo` only to disable semantic
analysis intentionally.

Long transcripts are split at speaker-turn boundaries. MeetMate analyzes each
chunk sequentially, stops with an error identifying the failed chunk if any
analysis fails, and only then merges the chunk results into final minutes.
The minutes also include prioritized key moments with transcript timestamps;
select a timestamp to seek the recording to that discussion.

## Auth model

- A **user** signs in with email + password.
- A **company** is an **organization**; the first person to register becomes its admin.
- **Membership** ties them together with an org role (admin or member).
- Every **meeting** belongs to an organization — that's the wall between tenants.
- Signup is OTP-verified; admins invite teammates by email.

The signed session cookie proves identity only; role and membership are read
from the database on every request, so suspending or re-roling a member takes
effect immediately.
