// Run with --concurrency=1 against a production build. Requires Chromium and ffmpeg.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.BASE_URL || 'http://127.0.0.1:6803';
const output = path.resolve('launch');
const time = new Date('2026-11-24T12:00:00Z');
assert(process.argv.includes('--concurrency=1'), 'Use --concurrency=1 for capture and encode');
await fs.mkdir(output, { recursive: true });
await fs.mkdir('.cache', { recursive: true });
const scratch = await fs.mkdtemp(path.resolve('.cache/desk-frames-'));
const frames = [];

async function open(browser, { viewport, studio = false, mobile = false }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
    timezoneId: 'UTC',
  });
  await context.addInitScript((showStudio) => {
    localStorage.setItem('thock-lab:v1', JSON.stringify({ hintsDismissed: true }));
    if (showStudio) {
      window.__THOCK_MANUAL__ = true;
    } else {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (kind.startsWith('webgl') || kind === 'experimental-webgl') return null;
        return getContext.call(this, kind, ...args);
      };
      sessionStorage.setItem('thock-lab:2d-notice', '1');
    }
  }, studio);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()) &&
        !/GPU stall due to ReadPixels|SwiftShader|cloudflareinsights|Service Worker registration blocked by Playwright/i.test(message.text() + message.location()?.url)) {
      errors.push(message.text());
    }
  });
  await page.clock.setFixedTime(time);
  await page.goto(origin, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, errors };
}

async function still(page, name) {
  await page.screenshot({ path: path.join(output, name), type: 'jpeg', quality: 91, animations: 'disabled' });
}

async function hold(page, key) {
  await page.keyboard.down(key);
  await page.locator('.desk-key[data-down="true"]').waitFor();
}

async function frame(page, seconds) {
  const name = `frame-${frames.length}.png`;
  await page.screenshot({ path: path.join(scratch, name), animations: 'disabled', caret: 'hide' });
  frames.push({ name, seconds });
}

try {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const studio = await open(browser, { viewport: { width: 1280, height: 800 }, studio: true });
    await studio.page.waitForFunction(() => window.__thockScene?.precompiled(), null, { timeout: 90000 });
    await studio.page.evaluate(() => window.__thockScene.advance(16));
    await still(studio.page, 'studio.jpg');
    assert.deepEqual(studio.errors, []);
    await studio.context.close();

    const desktop = await open(browser, { viewport: { width: 1120, height: 704 } });
    const { page } = desktop;
    await page.getByTestId('mode-desk-btn').click();
    await page.getByRole('heading', { name: 'Desk mode' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await frame(page, 1.32);
    for (const key of ['T', 'h', 'o', 'c', 'k', 'Space', 'l', 'a', 'b']) {
      await hold(page, key);
      await frame(page, 0.28);
      await page.keyboard.up(key);
    }
    await frame(page, 0.88);
    await hold(page, 'Space');
    await still(page, 'desk-desktop.jpg');
    await page.keyboard.up('Space');

    await page.getByLabel('Switch', { exact: true }).selectOption('clicky');
    await page.getByLabel('Base', { exact: true }).selectOption('aluminum');
    await page.getByRole('button', { name: 'Background' }).click();
    await page.getByRole('heading', { name: 'Desk mode' }).click();
    await page.mouse.move(12, 688);
    await frame(page, 1.36);
    for (const key of ['a', 's', 'd', 'Space', 'Enter']) {
      await hold(page, key);
      await frame(page, 0.28);
      await page.keyboard.up(key);
    }
    await frame(page, 1.64);
    assert.deepEqual(desktop.errors, []);
    await desktop.context.close();

    const phone = await open(browser, { viewport: { width: 390, height: 844 }, mobile: true });
    await phone.page.getByTestId('settings-btn').tap();
    await phone.page.getByTestId('settings-desk-btn').tap();
    await phone.page.getByText('Pair a physical keyboard to play.').waitFor();
    await phone.page.evaluate(() => document.fonts.ready);
    await still(phone.page, 'desk-mobile.jpg');
    assert.deepEqual(phone.errors, []);
    await phone.context.close();
  } finally {
    await browser.close();
  }

  const seconds = frames.reduce((total, frame) => total + frame.seconds, 0);
  assert(seconds <= 15, 'Demo is at most 15 seconds');
  const manifest = frames.map(({ name, seconds }) => `file '${name}'\nduration ${seconds}\n`).join('');
  await fs.writeFile(path.join(scratch, 'frames.ffconcat'), `ffconcat version 1.0\n${manifest}file '${frames.at(-1).name}'\n`);
  const gif = path.join(output, 'desk-mode.gif');
  const palette = path.join(scratch, 'palette.png');
  execFileSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-filter_complex_threads', '1',
    '-f', 'concat', '-safe', '0', '-i', 'frames.ffconcat',
    '-vf', 'palettegen=stats_mode=diff',
    '-frames:v', '1', palette,
  ], { cwd: scratch, stdio: ['ignore', 'inherit', 'inherit'] });
  execFileSync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-filter_complex_threads', '1',
    '-f', 'concat', '-safe', '0', '-i', 'frames.ffconcat', '-i', palette,
    '-lavfi', 'paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-fps_mode', 'vfr', '-threads', '1', '-loop', '0', gif,
  ], { cwd: scratch, stdio: ['ignore', 'inherit', 'inherit'] });
  const { size } = await fs.stat(gif);
  assert(size <= 8_000_000, 'Demo is at most 8 MB');
  console.log(`Desk demo and three screenshots captured (${seconds.toFixed(2)} seconds, ${size} bytes)`);
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
