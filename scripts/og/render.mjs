// Renders scripts/og/og.html to public/og.png (1200x630) with Playwright.
// The PNG is committed; this is only needed if the template or bg.png changes.
//
//   node scripts/og/render.mjs
//
// The raw screenshot is ~540 KB. The committed PNG was recompressed losslessly
// (Pillow: Image.open(p).convert('RGB').save(p, optimize=True, compress_level=9))
// to ~485 KB, to stay under 500 KB without palette banding in the gradient.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../public/og.png');

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(here, 'og.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log(`saved ${out}`);
