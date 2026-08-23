/**
 * Builds the Open Graph card at public/og.jpg.
 *
 * Run against a dev server, because the point is that the card is made of the
 * real page: the real fonts, the real tokens, the real product frames from the
 * hero. A card hand-drawn in a script drifts from the page the first time
 * either changes, and nobody notices, because nobody looks at an OG image
 * except in somebody else's Slack.
 *
 *   npm run dev            # in one terminal
 *   npm run og             # in another
 *
 * Pass a different origin as the first argument if the dev server is not on
 * 5173. The card is composed here rather than in the app: it exists only for
 * link unfurls, and a route that ships to every visitor to serve a crawler is
 * the wrong trade.
 *
 * 1200x630 at 2x. That is the size every scraper crops to, and JPEG rather
 * than WebP because Slack, iMessage and several others still will not take a
 * WebP og:image.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ORIGIN = process.argv[2] ?? "http://localhost:5173";
const OUT = fileURLToPath(new URL("../public/og.jpg", import.meta.url));
const TMP = fileURLToPath(new URL("../public/og.tmp.png", import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});

await page.goto(ORIGIN, { waitUntil: "networkidle" });
await page.waitForSelector("#top h1");
// The frames animate in. Give the entrance time to finish, or the card ships
// with the pair at opacity 0.
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const shot = document.querySelector('#top [class*="max-w-[1040px]"]');
  const clone = shot.cloneNode(true);
  // BlurFade leaves its finished transform inline. Cloned mid-page it can
  // carry a stale opacity, so reset anything the animation set.
  clone.querySelectorAll("*").forEach((el) => {
    el.style.opacity = "";
    el.style.transform = "";
    el.style.filter = "";
  });
  clone.style.margin = "0";
  clone.style.maxWidth = "none";
  // Seated against the bottom edge, bleeding 24px, rather than floating in a
  // band of white. NOT scaled up to fill: scale(1.18) was tried and it
  // cropped the field labels to "references", "ne" and "ocale" -- text sliced
  // mid-word, which is the same defect the bento mask and the mobile hero
  // were just fixed for. 24px is measured, not guessed: it takes the frames\'
  // empty lower border and stops well short of the assistant\'s footnote.
  clone.style.marginBottom = "-24px";

  document.body.innerHTML = "";
  document.body.style.margin = "0";

  // Geometry is inline, not Tailwind. Tailwind's JIT only emits the utilities
  // it finds when it scans the app's source, and this file is a build script
  // it never scans -- so `px-16`, `text-[76px]` and friends silently resolve
  // to nothing here. The first card came out with no padding and a 28px
  // headline for exactly that reason. Colours come from the CSS variables in
  // globals.css, which are real properties and always present; only the two
  // font-family classes are Tailwind, and both are used elsewhere in the app
  // so both are in the bundle.
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "1200px",
    height: "630px",
    overflow: "hidden",
    background: "hsl(var(--background))",
  });

  const strip = document.createElement("div");
  Object.assign(strip.style, {
    height: "12px",
    flexShrink: "0",
    background: "url('/landing/edge-strip-light.webp') center / cover no-repeat",
  });

  const head = document.createElement("div");
  Object.assign(head.style, { padding: "56px 64px 0" });

  const eyebrow = document.createElement("p");
  eyebrow.className = "font-mono";
  eyebrow.textContent = "Portable context for AI";
  Object.assign(eyebrow.style, {
    margin: "0",
    fontSize: "15px",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "hsl(var(--muted-foreground))",
  });

  const h1 = document.createElement("h1");
  h1.className = "font-display";
  h1.textContent = "Explain yourself once.";
  Object.assign(h1.style, {
    margin: "18px 0 0",
    fontSize: "80px",
    fontWeight: "600",
    lineHeight: "1.02",
    letterSpacing: "-0.02em",
    color: "hsl(var(--foreground))",
  });

  // The page's own opening sentence, verbatim from HERO.body. The card had
  // 250px of empty paper between the headline and the frames; filling it with
  // type the page already says beats inventing a line for a crawler.
  const sub = document.createElement("p");
  sub.textContent = "Every new chat starts from nothing.";
  Object.assign(sub.style, {
    margin: "20px 0 0",
    fontSize: "26px",
    color: "hsl(var(--muted-foreground))",
  });

  head.append(eyebrow, h1, sub);

  const stage = document.createElement("div");
  Object.assign(stage.style, {
    position: "relative",
    flex: "1",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    overflow: "hidden",
    padding: "40px 0 0",
  });
  stage.appendChild(clone);

  root.append(strip, head, stage);
  document.body.appendChild(root);
});

await page.waitForTimeout(400);
await page.screenshot({ path: TMP, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();

// sips ships with macOS; it is the one converter this repo can assume.
execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", TMP, "--out", OUT], {
  stdio: "ignore",
});
rmSync(TMP);
console.log(`wrote ${OUT}`);
