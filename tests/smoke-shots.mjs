// Quick layout screenshots (no WebGL → 2D studio) for visual iteration.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:6803').replace(/\/$/, '');
const OUT = path.resolve(process.env.OUT || 'qa/smoke');
fs.mkdirSync(OUT, { recursive: true });

const NO_WEBGL = `(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (/webgl/i.test(String(type))) return null;
    return orig.call(this, type, ...rest);
  };
})();`;

const views = (process.env.VIEWS || 'desktop,390,360,landscape').split(',');
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  360: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
};

const browser = await pw.chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2'] });
const errors = [];
try {
  for (const v of views) {
    const ctx = await browser.newContext({ ...VIEWPORTS[v], reducedMotion: 'reduce' });
    await ctx.addInitScript(NO_WEBGL);
    const page = await ctx.newPage();
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${v} ${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`${v} pageerror: ${e.message}`));
    await page.goto(BASE_URL + '/', { waitUntil: 'load' });
    await page.waitForSelector('[data-testid="fallback-clicker"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${v}-play-hints.jpg`, type: 'jpeg', quality: 80 });
    await page.click('[data-testid="onboarding-skip-btn"]');
    for (let i = 0; i < 3; i++) await page.click('[data-testid="fallback-clicker"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${v}-play.jpg`, type: 'jpeg', quality: 80 });
    await page.click('[data-testid="mode-customize-btn"]');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/${v}-customize-switch.jpg`, type: 'jpeg', quality: 80 });
    await page.click('[data-testid="tab-keycap"]');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${v}-customize-keycap.jpg`, type: 'jpeg', quality: 80 });
    await page.click('[data-testid="tab-base"]');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${v}-customize-base.jpg`, type: 'jpeg', quality: 80 });
    await page.click('[data-testid="tab-charm"]');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${v}-customize-charm.jpg`, type: 'jpeg', quality: 80 });
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? errors.join('\n') : 'no console errors');
