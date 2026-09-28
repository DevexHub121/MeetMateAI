/**
 * Apply a hand-written .sql file to the database.
 *
 * The project's convention is to add schema by hand rather than with
 * drizzle-kit push (see scripts/sql/*.sql for why). `psql -f` is the documented
 * way to do that; this exists for machines that don't have psql installed, and
 * behaves the same for the additive, idempotent DDL those files contain.
 *
 *   node --env-file=.env.local scripts/apply-sql.mjs scripts/sql/voice_profiles.sql
 *
 * Statements run one at a time over the Neon HTTP driver, which has no
 * transactions — the same reason the SQL files are written to be idempotent and
 * safe to re-run.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-sql.mjs <file.sql>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (try --env-file=.env.local)");
  process.exit(1);
}

const raw = fs.readFileSync(file, "utf8");

// Strip line comments, then split on statement boundaries. Adequate for DDL
// files of this shape; it is not a general-purpose SQL parser and does not try
// to be (no dollar-quoted bodies, no semicolons inside literals).
const statements = raw
  .split("\n")
  .map((l) => (l.trimStart().startsWith("--") ? "" : l))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const sql = neon(process.env.DATABASE_URL);
let ok = 0;
for (const stmt of statements) {
  const label = stmt.replace(/\s+/g, " ").slice(0, 72);
  try {
    await sql.query(stmt);
    console.log(`  ok  ${label}`);
    ok++;
  } catch (e) {
    console.error(`  FAIL ${label}\n       ${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${ok}/${statements.length} statements applied from ${file}`);
