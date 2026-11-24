// Targeted 3D checks with SwiftShader WebGL. Rendering is driven ONLY by the deterministic
// window.__thockScene.advance(ms) hook (manual mode: no rAF loop), except one short idle check
// that proves the render-on-demand loop stops by itself.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:6803').replace(/\/$/, '');
const OUT = path.resolve(process.env.OUT || 'qa/webgl');
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

function assert(c, m) {
  if (!c) throw new Error(`Assertion failed: ${m}`);
}

const SEED_STATE = (build) =>
  JSON.stringify({
    currentBuild: build,
    shelf: [],
    stats: { totalClicks: 0, bestCombo: 0, switchesTried: [], unlockedAchievements: [], maxSavedCount: 0 },
    settings: { volume: 0.6, muted: true, reducedMotion: false, haptics: false },
    hintsDismissed: true,
  });

const DEFAULT_BUILD = {
  switchType: 'thock',
  useDailyVariant: false,
  keycapShape: 'square',
  keycapColor: '#E85D3F',
  keycapFinish: 'matte',
  baseMaterial: 'wood',
  charm: 'cat',
};

const BUILDS = [
  ['01-default-square-matte-wood-cat', '1.th.0.sq.E85D3F.mt.wd.ct'],
  ['02-pill-metallic-aluminum-dice', '1.ar.0.pl.4B7BF5.me.al.dc'],
  ['03-lowprofile-glow-plastic-mushroom', '1.th.0.lp.F2A7B3.gw.ps.mu'],
  ['04-round-glossy-wood-cherry', '1.bb.0.rd.6CC7B8.gl.wd.ch'],
  ['05-tallartisan-frosted-acrylic-ghost', '1.tc.0.ta.A996E8.fr.ac.gh'],
  ['06-square-metallic-noir-aluminum-star', '1.cl.0.sq.2D2926.me.al.st'],
  ['07-tallartisan-glow-acrylic-cloud', '1.ln.0.ta.A996E8.gw.ac.cl'],
];

async function newPage(browser, viewport, { manual = true, build = DEFAULT_BUILD, isMobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile, hasTouch: isMobile });
  await ctx.addInitScript(
    ([state, manualFlag]) => {
      try {
        if (!sessionStorage.getItem('seeded')) {
          localStorage.setItem('thock-lab:v1', state);
          sessionStorage.setItem('seeded', '1');
        }
      } catch {}
      if (manualFlag) window.__THOCK_MANUAL__ = true;
    },
    [SEED_STATE(build), manual]
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const t = m.text();
      if (/GPU stall due to ReadPixels|SwiftShader|Automatic fallback to software WebGL/i.test(t)) return;
      errors.push(`[${m.type()}] ${t}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__thockScene, null, { timeout: 30000 });
  await page.addStyleTag({ content: '.toast-stack{display:none!important}' });
  return { ctx, page, errors };
}

async function setHashBuild(page, code) {
  await page.evaluate((c) => {
    window.location.hash = `b=${c}`;
  }, code);
  await page.waitForTimeout(120);
}

const shot = (page, name) =>
  page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 84, timeout: 90000 });
const warm = (page) => page.waitForFunction(() => window.__thockScene.precompiled(), null, { timeout: 120000 });
const want = (k) => !ONLY || ONLY.includes(k);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = {};
try {
  if (want('round5')) {
    const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 900 });
    const scene = () => page.evaluate(() => {
      const hook = window.__thockScene;
      return { held: hook.keyHeld(), ring: hook.pulseBounds(), gadget: hook.gadgetBounds(), frame: window.__thockFrame };
    });
    const registered = () => page.getByTestId('click-counter').locator('.counter-number').textContent();
    const waitForCount = (count) => page.waitForFunction(
      (expected) => document.querySelector('.counter-number')?.textContent === expected,
      count,
      { timeout: 3000 },
    );
    const key = page.getByRole('button', { name: 'Press the clicker' });
    await page.waitForFunction(() => window.__thockFrame?.h > 0);
    await page.keyboard.press('Tab');
    assert(await key.evaluate((el) => document.activeElement === el && el.matches(':focus-visible') &&
      getComputedStyle(el).outlineStyle === 'dashed'), '3D clicker is named and can be reached by Tab with visible focus');
    assert((await key.ariaSnapshot()).includes('button "Press the clicker"'), 'assistive technology sees the 3D button');
    await page.evaluate(() => { window.__liveCounter = document.querySelector('output[aria-live]'); });
    for (const [keyName, count] of [['Space', '1'], ['Enter', '2']]) {
      await page.keyboard.down(keyName);
      await waitForCount(count);
      assert((await scene()).held, `${keyName} presses exactly once`);
      await page.keyboard.down(keyName);
      assert(await registered() === count, `holding ${keyName} does not repeat`);
      await page.keyboard.up(keyName);
      assert(!(await scene()).held, `${keyName} releases the key`);
    }
    await key.evaluate((el) => el.click());
    await waitForCount('3');
    assert(await page.evaluate(() => window.__liveCounter === document.querySelector('output[aria-live]') &&
      window.__liveCounter.textContent.trim().startsWith('3 clicks')), 'live click count stays mounted');

    await key.evaluate((el) => el.blur());
    await page.keyboard.down('Space');
    await page.evaluate(() => window.__thockScene.advance(48));
    await page.keyboard.up('Space');
    const early = await scene();
    await page.evaluate(() => window.__thockScene.advance(224));
    await waitForCount('4');
    const late = await scene();
    const dockTop = (await page.getByRole('toolbar', { name: 'Main clicker actions' }).boundingBox()).y;
    assert(late.ring.right - late.ring.left > early.ring.right - early.ring.left + 8, 'ring still expands');
    assert(late.ring.bottom <= dockTop - 8 && late.ring.bottom <= late.frame.y + late.frame.h - 7.5, 'expanding ring clears the dock and stage boundary');
    await shot(page, 'round5-ring-272ms');

    const keyBox = await key.boundingBox();
    const keyX = keyBox.x + keyBox.width / 2;
    const keyY = keyBox.y + keyBox.height / 2;
    await page.mouse.move(keyX, keyY);
    await page.mouse.down({ button: 'right' });
    assert(!(await scene()).held && await registered() === '4', 'secondary mouse button does not press the 3D key');
    await page.mouse.up({ button: 'right' });
    await page.mouse.click(keyX, keyY);
    await waitForCount('5');

    await page.mouse.move(300, 340);
    await page.mouse.down();
    await page.mouse.move(472, 370, { steps: 5 });
    await page.mouse.up();
    await page.evaluate(() => window.__thockScene.advance(1400));
    assert(await registered() === '5', 'dragging the backdrop only orbits the camera');
    const floor = await page.evaluate(async () => {
      const hook = window.__thockScene;
      const bounds = hook.gadgetBounds();
      const image = new Image();
      image.src = hook.renderFrame();
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const alpha = (x, y) => data[(y * canvas.width + x) * 4 + 3];
      let sharpEdges = 0;
      let solidPixels = 0;
      for (let y = 5; y < canvas.height - 5; y++) {
        for (let x = 5; x < canvas.width - 5; x++) {
          if (x >= bounds.left - 5 && x <= bounds.right + 5 && y >= bounds.top - 5 && y <= bounds.bottom + 5) {
            if (alpha(x, y) >= 250) solidPixels++;
            continue;
          }
          if (Math.max(Math.abs(alpha(x - 4, y) - alpha(x + 4, y)), Math.abs(alpha(x, y - 4) - alpha(x, y + 4))) > 30) sharpEdges++;
        }
      }
      return { sharpEdges, solidPixels };
    });
    assert(floor.solidPixels > 1000 && floor.sharpEdges < 15, `orbited frame: ${JSON.stringify(floor)}`);
    await shot(page, 'round5-orbit');
    assert(errors.length === 0, errors.join('\n'));
    await ctx.close();

    const mobile = await newPage(browser, { width: 390, height: 844 }, { isMobile: true });
    await mobile.page.getByTestId('mode-customize-btn').tap();
    await mobile.page.setViewportSize({ width: 667, height: 375 });
    await mobile.page.waitForFunction(() => window.__thockFrame?.w > 120 && window.__thockFrame?.w < 390);
    await mobile.page.evaluate(() => window.__thockScene.advance(380));
    const measured = await mobile.page.evaluate(() => ({
      frame: window.__thockFrame,
      gadget: window.__thockScene.gadgetBounds(),
      tray: document.querySelector('.customize-sheet').getBoundingClientRect().left,
    }));
    const { frame, gadget, tray } = measured;
    assert(frame.x + frame.w <= tray - 4 && gadget.right <= tray - 8 && gadget.left >= frame.x &&
      gadget.top >= frame.y && gadget.bottom <= frame.y + frame.h, `rotated 3D instrument leaves the entire tray clear: ${JSON.stringify(measured)}`);
    await shot(mobile.page, 'round5-rotated-customizer');
    assert(mobile.errors.length === 0, mobile.errors.join('\n'));
    await mobile.ctx.close();
    results.round5 = { sharpFloorEdges: floor.sharpEdges, ringDockGap: Math.round(dockTop - late.ring.bottom), rotatedGadget: measured };
    console.log('round5', results.round5);
  }

  if (ONLY?.includes('round6')) {
    const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 }, {
      isMobile: true,
      build: {
        ...DEFAULT_BUILD,
        switchType: 'arcade',
        keycapShape: 'tall-artisan',
        keycapColor: '#A996E8',
        keycapFinish: 'frosted',
        baseMaterial: 'acrylic',
        charm: 'ghost',
      },
    });
    const rimPixels = (url, bounds) => page.evaluate(async ({ url, bounds }) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(...bounds.map(Math.round));
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = data.subarray(i, i + 4);
        if (a > 200 && r >= 90 && r <= 195 && b - r >= 10 && r >= g + 3) count++;
      }
      return count;
    }, { url, bounds });
    const stageRim = async (name) => {
      await page.evaluate(() => window.__thockScene.advance(380));
      const bounds = await page.evaluate(() => window.__thockScene.gadgetBounds());
      const width = bounds.right - bounds.left;
      const height = bounds.bottom - bounds.top;
      const frame = await page.screenshot();
      await shot(page, name);
      return rimPixels(`data:image/png;base64,${frame.toString('base64')}`, [
        bounds.left + width * 0.68,
        bounds.top + height * 0.78,
        width * 0.25,
        height * 0.22,
      ]);
    };
    const portrait = await stageRim('round6-frosted-portrait');
    await page.getByTestId('mode-customize-btn').tap();
    await page.setViewportSize({ width: 667, height: 375 });
    await page.waitForFunction(() => window.__thockFrame?.w > 120 && window.__thockFrame?.w < 390);
    const landscape = await stageRim('round6-frosted-landscape');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByTestId('snapshot-btn').tap(),
    ]);
    const png = fs.readFileSync(await download.path());
    assert(png.readUInt32BE(16) === 1080 && png.readUInt32BE(20) === 1080, 'actual square 3D PNG');
    const url = `data:image/png;base64,${png.toString('base64')}`;
    const exported = await rimPixels(url, [0.67 * 1080, 0.77 * 1080, 0.1 * 1080, 0.12 * 1080]);
    const preview = await ctx.newPage();
    await preview.setViewportSize({ width: 680, height: 680 });
    await preview.goto(url);
    await shot(preview, 'round6-frosted-export');
    await preview.close();
    results.round6 = { portrait, landscape, exported };
    console.log('round6 frosted silhouette', results.round6);
    assert(portrait >= 8 && landscape >= 3 && exported >= 100, 'the lavender rim is visible at both phone sizes and in the exported square');
    assert(!errors.length, errors.join('\n'));
    await ctx.close();
  }

  if (want('materials')) {
    const { ctx, page, errors } = await newPage(browser, { width: 1100, height: 760 });
    // wait for textures to decode (they trigger a rebuild), then render
    await page.waitForTimeout(600);
    for (const [name, code] of BUILDS) {
      await setHashBuild(page, code);
      await page.evaluate(() => window.__thockScene.advance(16));
      await shot(page, `mat-${name}`);
    }
    results.materialsErrors = errors;
    assert(errors.length === 0, `material frames errors:\n${errors.join('\n')}`);
    await ctx.close();
  }

  if (want('precompile')) {
    const { ctx, page, errors } = await newPage(browser, { width: 900, height: 640 });
    await page.evaluate(() => window.__thockScene.advance(16));
    await page.waitForFunction(() => window.__thockScene.precompiled(), null, { timeout: 90000 });
    const before = await page.evaluate(() => window.__thockScene.programs());
    await setHashBuild(page, '1.th.0.sq.E85D3F.gw.wd.ct');
    const glowMs = await page.evaluate(() => {
      const t0 = performance.now();
      window.__thockScene.advance(16);
      return performance.now() - t0;
    });
    const after = await page.evaluate(() => window.__thockScene.programs());
    await setHashBuild(page, '1.th.0.sq.E85D3F.mt.wd.ct');
    const plainMs = await page.evaluate(() => {
      const t0 = performance.now();
      window.__thockScene.advance(16);
      return performance.now() - t0;
    });
    results.precompile = { programsBefore: before, programsAfterGlow: after, glowFrameMs: Math.round(glowMs), plainFrameMs: Math.round(plainMs) };
    console.log('precompile', results.precompile);
    assert(after === before, `switching to glow compiled new programs (${before} → ${after})`);
    assert(errors.length === 0, errors.join('\n'));
    await ctx.close();
  }

  if (want('milestone')) {
    const { ctx, page, errors } = await newPage(browser, { width: 900, height: 640 });
    await warm(page);
    await page.evaluate(() => window.__thockScene.advance(16));
    let celebration = 0;
    for (let i = 1; i <= 25; i++) {
      await page.keyboard.down('Space');
      await page.evaluate(() => window.__thockScene.advance(30));
      await page.keyboard.up('Space');
      await page.evaluate(() => window.__thockScene.advance(30));
      if (i === 25) celebration = await page.evaluate(() => window.__thockScene.celebrationParticles());
    }
    await page.evaluate(() => window.__thockScene.advance(140));
    await shot(page, 'anim-milestone25');
    const counter = await page.locator('[data-testid="click-counter"]').innerText();
    results.milestone = { celebration, counter };
    console.log('milestone', results.milestone);
    assert(celebration >= 20, `milestone burst too small: ${celebration} celebration particles`);
    assert(counter.includes('25'), `counter ${counter}`);
    // press sequence frames
    await page.keyboard.down('Space');
    await page.evaluate(() => window.__thockScene.advance(32));
    await shot(page, 'anim-down-32ms');
    await page.keyboard.up('Space');
    await page.evaluate(() => window.__thockScene.advance(64));
    await shot(page, 'anim-rebound-96ms');
    assert(errors.length === 0, errors.join('\n'));
    await ctx.close();
  }

  if (want('framing')) {
    for (const [label, vp, mobile] of [
      ['mobile-390', { width: 390, height: 844 }, true],
      ['mobile-360', { width: 360, height: 740 }, true],
      ['landscape-844', { width: 844, height: 390 }, true],
      ['desktop-1280', { width: 1280, height: 800 }, false],
    ]) {
      const { ctx, page, errors } = await newPage(browser, vp, { isMobile: mobile });
      await warm(page);
      await page.evaluate(() => window.__thockScene.advance(16));
      await shot(page, `frame-${label}-play`);
      await page.click('[data-testid="mode-customize-btn"]');
      await page.waitForTimeout(450);
      await page.evaluate(() => window.__thockScene.advance(1200));
      await shot(page, `frame-${label}-customize`);
      assert(errors.length === 0, `${label}: ${errors.join('\n')}`);
      await ctx.close();
    }
  }

  if (want('idle')) {
    // (a) Full motion, deterministic: after a press the simulation settles and reports idle.
    {
      const { ctx, page, errors } = await newPage(browser, { width: 640, height: 480 });
      await warm(page);
      await page.keyboard.down('Space');
      await page.evaluate(() => window.__thockScene.advance(60));
      await page.keyboard.up('Space');
      const settleMs = await page.evaluate(() => {
        let t = 0;
        while (t < 15000) {
          window.__thockScene.advance(100);
          t += 100;
          if (!window.__thockScene.isAnimating()) return t;
        }
        return -1;
      });
      results.settleSimulatedMs = settleMs;
      console.log('full-motion settles after (simulated ms)', settleMs);
      assert(settleMs > 0 && settleMs <= 8000, `scene never settled (${settleMs})`);
      assert(errors.length === 0, errors.join('\n'));
      await ctx.close();
    }
    // (b) Real rAF loop: idle at load → zero frames; tap → frames; then the loop stops by itself.
    {
      const ctx = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await ctx.addInitScript((state) => {
        try {
          if (!sessionStorage.getItem('seeded')) {
            localStorage.setItem('thock-lab:v1', state);
            sessionStorage.setItem('seeded', '1');
          }
        } catch {}
      }, SEED_STATE(DEFAULT_BUILD).replace('"reducedMotion":false', '"reducedMotion":true'));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE_URL + '/', { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__thockScene, null, { timeout: 30000 });
      await warm(page);
      await page.waitForTimeout(800);
      const a = await page.evaluate(() => window.__thockScene.renderCount());
      await page.waitForTimeout(1500);
      const b = await page.evaluate(() => window.__thockScene.renderCount());
      const box = await page.locator('[data-testid="clicker-canvas"]').boundingBox();
      const counterBefore = await page.locator('[data-testid="click-counter"]').innerText();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.52, { delay: 40 });
      await page.waitForTimeout(300);
      const c = await page.evaluate(() => window.__thockScene.renderCount());
      const counterAfter = await page.locator('[data-testid="click-counter"]').innerText();
      await page.waitForFunction(() => !window.__thockScene.isAnimating(), null, { timeout: 30000 });
      const d = await page.evaluate(() => window.__thockScene.renderCount());
      await page.waitForTimeout(1200);
      const e = await page.evaluate(() => window.__thockScene.renderCount());
      // m2: double-clicking the 3D backdrop must fire exactly ONE "Camera angle reset" toast
      await page.mouse.dblclick(box.x + 28, box.y + box.height * 0.5);
      await page.waitForTimeout(250);
      const resetToasts = await page.locator('[data-testid="toast-item"]', { hasText: 'Camera angle reset' }).count();
      results.idle = { idleFramesAtLoad: b - a, framesAfterTap: c - b, framesAfterSettle: e - d, counterBefore, counterAfter, resetToasts };
      console.log('idle', results.idle);
      assert(b - a === 0, `renders while idle: ${b - a}`);
      assert(c - b > 0, 'no renders after tap');
      assert(e - d === 0, `renders after settling: ${e - d}`);
      assert(counterAfter !== counterBefore, '3D raycast tap did not register a click');
      assert(resetToasts === 1, `expected 1 camera-reset toast on dblclick, got ${resetToasts}`);
      assert(errors.length === 0, errors.join('\n'));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
}
console.log('WEBGL CHECKS PASSED');
