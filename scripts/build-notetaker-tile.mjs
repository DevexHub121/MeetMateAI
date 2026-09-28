/**
 * Builds the images the note-taker shows as its camera feed in a call.
 *
 * Run with:  node scripts/build-notetaker-tile.mjs
 * Outputs:   public/notetaker/recording.jpg, public/notetaker/idle.jpg
 *
 * These are committed, not generated at request time. Recall wants a JPEG and
 * the design only changes when someone edits this file, so building it on a
 * server would mean carrying a native image dependency and a cache to redo work
 * whose answer is always the same. `sharp` is used here as an authoring tool —
 * it arrives with Next and is never imported by the app itself.
 *
 * Rendering goes through headless Chrome rather than an SVG rasteriser so the
 * tile can use Bricolage Grotesque, the same display face as the product. An
 * SVG library would have silently substituted whatever font it could find.
 *
 * Recall's constraints, which the checks at the bottom enforce: JPEG, 16:9,
 * 1280x720, under 1.3 MB. Drawn at 2x and downscaled, per their guidance, so
 * the strokes and type stay crisp after the platform re-encodes it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 2560;
const H = 1440;

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** The MeetMate mark (src/components/MeetMateMark.tsx): a note card with a voice
 *  soundwave, without the tile background. */
const MARK = `
<svg viewBox="0 0 64 64" width="420" height="420" fill="none"
     xmlns="http://www.w3.org/2000/svg">
  <rect x="12" y="10" width="40" height="44" rx="10"
        stroke="#f4f4f2" stroke-width="3.2"/>
  <g stroke="#f4f4f2" stroke-width="3.2" stroke-linecap="round">
    <line x1="24" y1="28" x2="24" y2="36"/>
    <line x1="32" y1="22" x2="32" y2="42"/>
    <line x1="40" y1="26" x2="40" y2="38"/>
  </g>
</svg>`;

const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600&family=Instrument+Sans:wght@500";

/**
 * Fetches the webfonts and inlines them as data URIs.
 *
 * The obvious version of this links to Google Fonts and gives Chrome a few
 * seconds to catch up. That silently produced a wrong tile: the two renders
 * disagreed by 29px on the width of the word "Echo", because one of them
 * screenshotted before the font landed and fell back to a system face. A
 * timeout is a hope. Downloading first and embedding the bytes means the render
 * has no network dependency left to lose a race against.
 */
async function inlineFontCss() {
  // Google serves woff2 only to user agents it believes support it.
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const res = await fetch(FONT_CSS_URL, { headers: { "User-Agent": ua } });
  if (!res.ok) throw new Error(`font css: ${res.status}`);
  let css = await res.text();

  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) ?? [])];
  if (!urls.length) throw new Error("no font files in css");

  for (const url of urls) {
    const font = await fetch(url, { headers: { "User-Agent": ua } });
    if (!font.ok) throw new Error(`font ${url}: ${font.status}`);
    const buf = Buffer.from(await font.arrayBuffer());
    // "wOF2" — a truncated or error-page response would otherwise sail through
    // and land us right back at a silent fallback.
    if (buf.subarray(0, 4).toString("latin1") !== "wOF2") {
      throw new Error(`font ${url} is not woff2`);
    }
    css = css.replaceAll(url, `data:font/woff2;base64,${buf.toString("base64")}`);
  }
  console.log(`embedded ${urls.length} font files`);
  return css;
}

const FONT_CSS = await inlineFontCss();

/**
 * `status` is rendered at 52px in the final image. Recall recommends a 50px
 * floor because these tiles are shown small in a participant grid and then
 * re-compressed by the meeting platform.
 */
function page({ status, dotColor }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${FONT_CSS}</style>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; }
  body {
    background: #000000;
    display: flex; align-items: center; justify-content: center;
    -webkit-font-smoothing: antialiased;
  }
  /* Barely-there lift off pure black so the tile reads as a designed surface
     rather than a dead feed, without stopping being black. */
  .glow {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse 55% 60% at 50% 44%,
                rgba(255,255,255,0.055), rgba(0,0,0,0) 70%);
  }
  /* A smooth dark gradient quantises into visible rings once JPEG gets hold of
     it. A few percent of noise dithers the steps back out, and costs ~15 KB
     against a 1.3 MB budget. */
  .grain {
    position: absolute; inset: 0; opacity: 0.055; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>\
<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/></filter>\
<rect width='240' height='240' filter='url(%23n)'/></svg>");
  }
  .stack {
    position: relative; display: flex; flex-direction: column;
    align-items: center; gap: 56px;
  }
  .mark { display: flex; filter: drop-shadow(0 0 60px rgba(255,255,255,0.16)); }
  .word {
    font-family: "Bricolage Grotesque", sans-serif;
    font-weight: 600; font-size: 224px; line-height: 1;
    letter-spacing: -0.035em; color: #f4f4f2;
  }
  .status {
    display: flex; align-items: center; gap: 22px;
    font-family: "Instrument Sans", sans-serif;
    font-weight: 500; font-size: 104px; line-height: 1;
    letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(244,244,242,0.62);
  }
  .dot { width: 34px; height: 34px; border-radius: 999px; background: ${dotColor}; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="grain"></div>
  <div class="stack">
    <div class="mark">${MARK}</div>
    <div class="word">MeetMate</div>
    <div class="status"><span class="dot"></span>${status}</div>
  </div>
</body></html>`;
}

const tmp = mkdtempSync(join(tmpdir(), "echo-tile-"));

/**
 * Asks Chrome, in the page, whether it can actually use both faces.
 *
 * The embedded fonts above make a fallback unlikely, not impossible — a bad
 * @font-face rule or a face Chrome declines to parse would still render in
 * Helvetica and still exit 0. This is the one question worth asking directly,
 * because the answer is invisible in the output: a tile in the wrong typeface
 * looks perfectly fine until you put it next to the product.
 */
function assertFontsLoaded() {
  const probe = join(tmp, "fonts.html");
  writeFileSync(
    probe,
    `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}</style>
<body><script>
  document.fonts.ready.then(() => {
    const ok = document.fonts.check('600 224px "Bricolage Grotesque"')
            && document.fonts.check('500 104px "Instrument Sans"');
    document.body.id = ok ? "FONTS-OK" : "FONTS-MISSING";
  });
</script></body>`,
  );
  const dom = execFileSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--dump-dom", "--virtual-time-budget=5000",
     `file://${probe}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (!dom.includes("FONTS-OK")) {
    throw new Error("Bricolage Grotesque / Instrument Sans did not load — tile would ship in a fallback face");
  }
  console.log("ok   fonts available in headless Chrome");
}

assertFontsLoaded();

async function build(name, html) {
  const htmlPath = join(tmp, `${name}.html`);
  const pngPath = join(tmp, `${name}.png`);
  writeFileSync(htmlPath, html);

  execFileSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${W},${H}`,
    `--screenshot=${pngPath}`,
    // Everything the page needs is inline, so this only has to cover layout and
    // the decode of the embedded faces.
    "--virtual-time-budget=4000",
    `file://${htmlPath}`,
  ]);

  const out = join(ROOT, "public/notetaker", `${name}.jpg`);
  await sharp(pngPath)
    .resize(1280, 720, { fit: "cover" })
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toFile(out);

  const { width, height } = await sharp(out).metadata();
  const bytes = statSync(out).size;
  const ok = width === 1280 && height === 720 && bytes < 1.3 * 1024 * 1024;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}.jpg  ${width}x${height}  ${(bytes / 1024).toFixed(0)} KB`,
  );
  if (!ok) process.exitCode = 1;

  // A blank render is the failure that looks like success — Chrome exits 0 and
  // writes a perfectly valid black rectangle. Catch it by insisting the image
  // has some light in it.
  const stats = await sharp(out).stats();
  const mean = stats.channels[0].mean;
  if (mean < 1) {
    console.log(`FAIL ${name}.jpg is blank (mean luma ${mean.toFixed(2)})`);
    process.exitCode = 1;
  }
}

await build("recording", page({ status: "Recording", dotColor: "#ef4444" }));
await build("idle", page({ status: "Waiting to record", dotColor: "rgba(244,244,242,0.45)" }));
console.log(`\nsource html kept in ${tmp}`);
