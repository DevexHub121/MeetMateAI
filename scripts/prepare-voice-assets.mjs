/**
 * Stage the ONNX Runtime wasm binaries into public/ort so the browser can load
 * the speaker-embedding model.
 *
 * Runs from `prebuild`. Copies out of node_modules rather than fetching, so the
 * build needs no network and the wasm can never drift from the onnxruntime-web
 * version transformers.js was compiled against — the default is a CDN URL
 * pinned to ORT's exact version, which for a dev build like 1.26.0-dev is not
 * published anywhere.
 *
 * ~25 MB of binaries, hence public/ort is gitignored and produced at build time.
 * The model itself is small enough to commit and lives in public/models.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = "node_modules/onnxruntime-web/dist";
const DEST = "public/ort";

// Every ort-wasm-* variant, rather than a hand-picked subset.
//
// ORT chooses its build at runtime from what the browser supports (threads,
// SharedArrayBuffer, WebGPU, JSPI) and loads the matching .mjs/.wasm pair by
// name. Guessing wrong fails only in the browser, at the moment someone tries to
// record — which is exactly where a missing file is most expensive to discover.
// A browser downloads just the one variant it needs; the rest only cost deploy
// space.
const PATTERN = /^ort-wasm-.*\.(wasm|mjs)$/;

if (!fs.existsSync(SRC)) {
  console.error(
    `[voice-assets] ${SRC} not found — is onnxruntime-web installed?`,
  );
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });

const names = fs.readdirSync(SRC).filter((n) => PATTERN.test(n));
if (names.length === 0) {
  console.error(`[voice-assets] no ort-wasm-* files found in ${SRC}`);
  process.exit(1);
}

let copied = 0;
let skipped = 0;
for (const name of names) {
  const from = path.join(SRC, name);
  const to = path.join(DEST, name);
  // Copy when absent or stale, so repeat builds are cheap.
  const fresh =
    fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size;
  if (fresh) {
    skipped++;
    continue;
  }
  fs.copyFileSync(from, to);
  copied++;
}

console.log(
  `[voice-assets] ort wasm ready in ${DEST} (${copied} copied, ${skipped} up to date)`,
);
