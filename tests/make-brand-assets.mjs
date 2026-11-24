// Generates PWA icons (any + maskable + apple-touch) from the brand mark and an art-directed
// 1200×630 Open Graph image: generated studio backdrop + a real 3D render of the product + wordmark.
// Run: tests/with-server.sh preview tests/make-brand-assets.mjs   (then PIL-optimises og.png)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:6803').replace(/\/$/, '');
const root = path.resolve('.');
const tmp = path.join(root, 'art-src');
fs.mkdirSync(tmp, { recursive: true });

const MARK = fs
  .readFileSync(path.join(root, 'public/favicon.svg'), 'utf8')
  .replace('<svg ', '<svg width="100%" height="100%" ');

function iconHtml(size, { maskable, rounded }) {
  const markPct = maskable ? 54 : 66;
  return `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent">
  <div style="position:absolute;inset:0;border-radius:${rounded ? '22%' : '0'};overflow:hidden;
    background:radial-gradient(120% 100% at 50% 30%,#FFF9F2 0%,#F7E9DC 55%,#E9D2C0 100%)">
    <div style="position:absolute;left:50%;top:50%;width:${markPct * 1.35}%;height:${markPct * 0.32}%;transform:translate(-50%,${size * 0.16}px);
      background:radial-gradient(closest-side,rgba(60,30,15,.22),rgba(60,30,15,0));"></div>
    <div style="position:absolute;left:50%;top:48%;width:${markPct}%;height:${markPct}%;transform:translate(-50%,-50%);
      filter:drop-shadow(0 ${size * 0.02}px ${size * 0.03}px rgba(110,45,20,.25))">${MARK}</div>
  </div></body></html>`;
}

const SEED = JSON.stringify({
  currentBuild: {
    switchType: 'thock',
    useDailyVariant: false,
    keycapShape: 'square',
    keycapColor: '#E85D3F',
    keycapFinish: 'glossy',
    baseMaterial: 'wood',
    charm: 'cat',
  },
  shelf: [],
  stats: { totalClicks: 0, bestCombo: 0, switchesTried: [], unlockedAchievements: [], maxSavedCount: 0 },
  settings: { volume: 0.6, muted: true, reducedMotion: false, haptics: false },
  hintsDismissed: true,
});

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  // 1) Icons
  const icons = [
    ['public/icon-192.png', 192, { maskable: false, rounded: true }],
    ['public/icon-512.png', 512, { maskable: false, rounded: true }],
    ['public/icon-maskable-512.png', 512, { maskable: true, rounded: false }],
    ['public/icon-maskable-192.png', 192, { maskable: true, rounded: false }],
    ['public/apple-touch-icon.png', 180, { maskable: false, rounded: false }],
  ];
  for (const [file, size, opts] of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(iconHtml(size, opts));
    await page.screenshot({ path: path.join(root, file), omitBackground: true });
    await page.close();
  }

  // 2) Real 3D render (transparent) of the hero build
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((state) => {
    localStorage.setItem('thock-lab:v1', state);
    window.__THOCK_MANUAL__ = true;
  }, SEED);
  const page = await ctx.newPage();
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__thockScene);
  await page.waitForFunction(() => window.__thockScene.precompiled(), null, { timeout: 120000 });
  await page.evaluate(() => window.__thockScene.advance(16));
  const renderUrl = await page.evaluate(() => window.__thockScene.renderPng(900));

  // 3) Compose OG on the app origin (brand fonts already loaded by the app CSS)
  const backdrop = 'data:image/png;base64,' + fs.readFileSync(path.join(tmp, 'backdrop.png')).toString('base64');
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.evaluate(
    ({ backdrop, renderUrl, mark }) => {
      document.body.innerHTML = `
      <div id="og" style="position:fixed;inset:0;width:1200px;height:630px;overflow:hidden;font-family:'Plus Jakarta Sans Variable',sans-serif;color:#1F1A17;
        background:url(${backdrop}) center/cover">
        <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,250,244,.82) 0%,rgba(255,250,244,.55) 38%,rgba(255,250,244,0) 60%)"></div>
        <img src="${renderUrl}" style="position:absolute;right:-48px;top:-14px;width:660px;height:660px" />
        <div style="position:absolute;left:72px;top:118px;width:540px">
          <div style="display:flex;align-items:center;gap:18px">
            <div style="width:84px;height:84px;filter:drop-shadow(0 6px 10px rgba(110,45,20,.25))">${mark}</div>
            <div style="font-family:'Bricolage Grotesque Variable',sans-serif;font-weight:800;font-size:92px;letter-spacing:-0.045em;line-height:1">
              Thock<span style="font-weight:500;color:#C9472B;margin-left:6px">Lab</span></div>
          </div>
          <div style="margin-top:26px;font-size:34px;font-weight:700;line-height:1.2;letter-spacing:-0.01em">
            Build a chunky little clicker.<br/>Tap it. Hear the <span style="color:#C9472B">thock</span>.</div>
          <div style="margin-top:22px;font-size:20px;font-weight:600;color:#5F534A;line-height:1.45">
            6 synthesized switches · keycaps, bases &amp; charms<br/>share a link · snapshot · works offline</div>
          <div style="margin-top:30px;display:inline-flex;align-items:center;gap:10px;padding:12px 20px;border-radius:999px;background:#1F1A17;color:#FFF8F1;font-weight:700;font-size:20px">
            thock.algoty.com</div>
        </div>
      </div>`;
      document.documentElement.style.overflow = 'hidden';
    },
    { backdrop, renderUrl, mark: MARK }
  );
  await page.waitForTimeout(400);
  await page.locator('#og').screenshot({ path: path.join(tmp, 'og-raw.png') });
  await ctx.close();
} finally {
  await browser.close();
}

execFileSync('python3', [
  '-c',
  `
from PIL import Image
im = Image.open('art-src/og-raw.png').convert('RGB')
q = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
q.save('public/og.png', optimize=True)
import os
print('og.png', os.path.getsize('public/og.png'), 'bytes')
for f in ['public/icon-192.png','public/icon-512.png','public/icon-maskable-512.png','public/icon-maskable-192.png','public/apple-touch-icon.png']:
    im = Image.open(f)
    if 'maskable' in f or 'apple' in f:
        im = im.convert('RGB')  # full-bleed, opaque
        im.save(f, optimize=True)
    print(f, im.size, im.mode, os.path.getsize(f))
`,
], { stdio: 'inherit', cwd: root });
console.log('brand assets done');
