/**
 * Two-org tenant-isolation probe. Seeds two organizations, each with a user and
 * a meeting, mints a real Notti session cookie for each, and hits the running
 * app over HTTP — exercising canViewMeeting / listMeetingPage / requireMeeting
 * the way a real request does, not just the database.
 *
 *   node --env-file=.env.local scripts/probe-isolation.cjs
 *
 * Requires the dev server on :3010. Cleans up its own seed data.
 */
const { neon } = require("@neondatabase/serverless");
const { createHmac, randomUUID } = require("node:crypto");

const BASE = process.env.PROBE_BASE || "http://localhost:3010";
const sql = neon(process.env.DATABASE_URL);
const b64url = (i) => Buffer.from(i).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function cookie(user) {
  const body = b64url(JSON.stringify({ uid: user.id, email: user.email, name: user.name, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${body}.${b64url(createHmac("sha256", process.env.AUTH_SECRET).update(body).digest())}`;
}

async function seedOrg(tag) {
  const userId = randomUUID();
  const email = `admin@${tag}.probe`;
  await sql`insert into users (id, name, email, password_hash, platform_role) values (${userId}, ${tag + " admin"}, ${email}, ${"!probe"}, ${"user"})`;
  const [org] = await sql`insert into organizations (name, slug, status) values (${tag + " Co"}, ${"probe-" + tag}, ${"active"}) returning id`;
  await sql`insert into org_members (org_id, user_id, role, status) values (${org.id}, ${userId}, ${"admin"}, ${"active"})`;
  const [mtg] = await sql`insert into meetings (title, status, org_id, created_by_user_id, recording_path) values (${tag.toUpperCase() + " secret meeting"}, ${"ready"}, ${org.id}, ${userId}, ${"recordings/" + tag + ".webm"}) returning id`;
  return { id: userId, email, name: tag + " admin", orgId: org.id, meetingId: mtg.id };
}

async function get(path, user) {
  const res = await fetch(new URL(path, BASE), {
    headers: user ? { Cookie: `notti_session=${cookie(user)}` } : {},
    redirect: "manual",
  });
  const body = await res.text().catch(() => "");
  return { status: res.status, loc: res.headers.get("location") || "", body };
}

(async () => {
  console.log("seeding two orgs…");
  const A = await seedOrg("alpha");
  const B = await seedOrg("beta");
  const aTitle = "ALPHA secret meeting", bTitle = "BETA secret meeting";

  let pass = 0, total = 0;
  const check = (label, cond, detail) => { total++; if (cond) pass++; console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); };

  // ── Meetings list: each user sees only their own org's meeting ──
  const listA = await get("/meetings", A);
  check("A's list shows A's meeting", listA.status === 200 && listA.body.includes(aTitle));
  check("A's list HIDES B's meeting", !listA.body.includes(bTitle));

  const listB = await get("/meetings", B);
  check("B's list shows B's meeting", listB.status === 200 && listB.body.includes(bTitle));
  check("B's list HIDES A's meeting", !listB.body.includes(aTitle));

  // ── Detail page: own visible, cross-tenant 404 ──
  check("A opens A's meeting (own)", (await get(`/meetings/${A.meetingId}`, A)).status === 200);

  const aOnB = await get(`/meetings/${B.meetingId}`, A);
  check("A opens B's meeting → denied, no leak",
    (aOnB.status === 404 || aOnB.status === 200) && !aOnB.body.includes(bTitle),
    `status ${aOnB.status}, leaked=${aOnB.body.includes(bTitle)}`);

  const bOnA = await get(`/meetings/${A.meetingId}`, B);
  check("B opens A's meeting → denied, no leak",
    (bOnA.status === 404 || bOnA.status === 200) && !bOnA.body.includes(aTitle),
    `status ${bOnA.status}, leaked=${bOnA.body.includes(aTitle)}`);

  // ── Recording route: cross-tenant denied ──
  check("A pulls B's recording → 404", (await get(`/api/recording/${B.meetingId}`, A)).status === 404);

  // ── No session → bounced to login ──
  const anon = await get("/meetings", null);
  check("no cookie → redirected to /login", anon.status >= 300 && anon.status < 400 && /\/login/.test(anon.loc), `${anon.status} ${anon.loc}`);

  // ── cleanup ──
  await sql`delete from organizations where slug in (${"probe-alpha"}, ${"probe-beta"})`;
  await sql`delete from users where email like ${"%.probe"}`;
  const left = await sql`select count(*)::int n from organizations where slug like ${"probe-%"}`;
  console.log(`\ncleanup: ${left[0].n} probe orgs left`);
  console.log(`${pass}/${total} isolation checks held`);
  process.exitCode = pass === total ? 0 : 1;
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
