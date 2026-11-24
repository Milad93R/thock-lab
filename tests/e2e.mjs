// Thock Lab end-to-end suite.
//   ENGINE=chromium|webkit   SUITES=comma list (default: all for the engine)   BASE_URL=…
// Flow tests run WITHOUT WebGL (Chromium: --disable-webgl; WebKit: getContext('webgl*') → null),
// which also exercises the no-WebGL 2D studio end to end. 3D frames live in tests/webgl-shots.mjs.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:6803').replace(/\/$/, '');
const ENGINE = process.env.ENGINE || 'chromium';
const LOCAL = /127\.0\.0\.1|localhost/.test(BASE_URL);
const QA = path.resolve('qa');
fs.mkdirSync(QA, { recursive: true });
const DEFAULT_SUITES =
  ENGINE === 'webkit'
    ? ['round7', 'geometry', 'breakpoints', 'round5', 'round6', 'webkit-iphone', ...(LOCAL ? [] : ['webkit-offline'])]
    : ['round7', 'static', 'geometry', 'breakpoints', 'round5', 'round6', 'desktop', 'tablet', 'mobile390', 'mobile390x664', 'mobile360x640', 'landscape667', 'landscape', 'malformed', 'offline'];
const SUITES = process.env.SUITES ? process.env.SUITES.split(',') : DEFAULT_SUITES;
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const passed = [];
function assert(c, m) {
  if (!c) throw new Error(`Assertion failed: ${m}`);
}
const shot = (page, name, clip) => page.screenshot({ path: path.join(QA, `${name}.jpg`), type: 'jpeg', quality: 80, clip });

const INIT = `(() => {
  // No WebGL in flow tests (also the real-world no-WebGL path)
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (/webgl/i.test(String(type))) return null;
    return orig.call(this, type, ...rest);
  };
  // Count real Web Audio synthesis so tests prove taps make sound
  window.__audioStats = { contexts: 0, oscillators: 0, sources: 0 };
  window.__audioFilters = [];
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const p = AC.prototype;
    const filter = p.createBiquadFilter;
    p.createBiquadFilter = function () { const node = filter.apply(this, arguments); window.__audioFilters.push(node); return node; };
    const osc = p.createOscillator;
    p.createOscillator = function () { window.__audioStats.oscillators++; return osc.apply(this, arguments); };
    const gain = p.createGain;
    p.createGain = function () { const g = gain.apply(this, arguments); if (!window.__audioStats.master) window.__audioStats.master = g; return g; };
    const src = p.createBufferSource;
    p.createBufferSource = function () { window.__audioStats.sources++; return src.apply(this, arguments); };
    const Wrapped = function (...a) { window.__audioStats.contexts++; return new AC(...a); };
    Wrapped.prototype = AC.prototype;
    window.AudioContext = Wrapped;
  }
})();`;

function guard(page, label) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    const loc = m.location()?.url || '';
    if (/cloudflareinsights|cdn-cgi\/rum/i.test(t) || /cloudflareinsights|cdn-cgi\/rum/i.test(loc)) return;
    errors.push(`[${label} console.${m.type()}] ${t}${loc ? ` (${loc})` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label} pageerror] ${e.message}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/cloudflareinsights|cdn-cgi\/rum/i.test(u)) return;
    if (u.startsWith('blob:') || u.startsWith('data:')) return;
    errors.push(`[${label} requestfailed] ${u} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && !/nonexistent-route-qa|cdn-cgi/.test(u)) errors.push(`[${label} http ${r.status()}] ${u}`);
    if (/googleapis|gstatic|googletagmanager|google-analytics|firebase/i.test(u)) errors.push(`[${label} google] ${u}`);
  });
  return errors;
}

async function open(browser, ctxOpts, label, url = BASE_URL + '/') {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', ...ctxOpts });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = guard(page, label);
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('[data-testid="fallback-clicker"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(350);
  return { ctx, page, errors };
}

const rect = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
  }, sel);

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
  const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Visible toasts must never overlap the top bar, counter HUD, plaques, keycap, onboarding card, sheet or modal card. */
async function assertToastClear(page, label, { allowTopBar = false } = {}) {
  const count = await page.locator('[data-testid="toast-item"]').count();
  assert(count === 1, `[${label}] expected exactly 1 visible toast, got ${count}`);
  const toast = await rect(page, '[data-testid="toast-item"]');
  assert(toast && toast.w > 20 && toast.h > 10, `[${label}] expected visible toast`);
  const obstacles = allowTopBar
    ? ['.modal-card']
    : [
        '.brand-pill',
        '.top-bar-actions',
        '.daily-pill',
        '.counter-readout',
        '.combo-pill.is-visible',
        '[data-testid="milestone-banner"]',
        '.customize-sheet',
        '.onboarding-card',
        '.bottom-dock',
        '[data-testid="fallback-stage"]',
      ];
  for (const sel of obstacles) {
    const visible = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
    }, sel);
    if (!visible) continue;
    const o = await rect(page, sel);
    if (!o || o.w === 0) continue;
    const area = overlapArea(toast, o);
    assert(area === 0, `[${label}] toast (${JSON.stringify(toast)}) overlaps ${sel} (${JSON.stringify(o)}) by ${Math.round(area)}px²`);
  }
}

/** Pairwise zero-intersection geometry audit across HUD, plaques, reserved toast lane, chrome, and keycap. */
async function assertFullGeometryMatrix(page, label, expected = []) {
  const selectors = [
    '.brand-pill',
    '.daily-pill',
    '.top-bar-actions',
    '.counter-readout',
    '.combo-pill.is-visible',
    '[data-testid="milestone-banner"]',
    '[data-testid="toast-lane"]',
    '[data-testid="toast-item"]',
    '.onboarding-card',
    '.customize-sheet',
    '.bottom-dock',
    '[data-testid="fallback-stage"]',
  ];
  const res = await page.evaluate((sels) => {
    const boxes = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      boxes.push({ sel, x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height });
    }
    const collisions = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        // toast-item intentionally sits inside toast-lane
        if (
          (a.sel === '[data-testid="toast-lane"]' && b.sel === '[data-testid="toast-item"]') ||
          (b.sel === '[data-testid="toast-lane"]' && a.sel === '[data-testid="toast-item"]')
        ) {
          continue;
        }
        const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
        const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
        if (w > 0.5 && h > 0.5) {
          collisions.push({ a: a.sel, b: b.sel, area: Math.round(w * h), rectA: a, rectB: b });
        }
      }
    }
    const findBox = (sel) => boxes.find((box) => box.sel === sel);
    const lane = findBox('[data-testid="toast-lane"]');
    const toast = findBox('[data-testid="toast-item"]');
    const toastInsideLane = !!(lane && toast && toast.x >= lane.x && toast.y >= lane.y && toast.r <= lane.r && toast.b <= lane.b);
    for (const box of boxes) {
      if (box.x < -0.75 || box.y < -0.75 || box.r > innerWidth + 0.75 || box.b > innerHeight + 0.75) {
        collisions.push({ a: box.sel, b: 'viewport edge', area: -1, rectA: box });
      }
    }
    const stage = findBox('[data-testid="fallback-stage"]');
    const keyHit = !!stage && !!document.elementFromPoint(stage.x + stage.w / 2, stage.y + stage.h * 0.42)?.closest('[data-testid="fallback-clicker"]');
    const hud = document.querySelector('.counter-hud').getBoundingClientRect();
    for (const box of [findBox('.daily-pill'), lane].filter(Boolean)) {
      const w = Math.min(hud.right, box.r) - Math.max(hud.left, box.x);
      const h = Math.min(hud.bottom, box.b) - Math.max(hud.top, box.y);
      if (w > 0.5 && h > 0.5) collisions.push({ a: '.counter-hud', b: box.sel, area: Math.round(w * h), rectA: hud.toJSON(), rectB: box });
    }
    return {
      collisions,
      stage,
      keyHit,
      toastCount: document.querySelectorAll('[data-testid="toast-item"]').length,
      toastInsideLane,
      visible: boxes.map((box) => box.sel),
    };
  }, selectors);
  assert(res.toastCount === 1 && res.toastInsideLane, `[${label}] expected one toast entirely contained in the reserved lane (count=${res.toastCount}, visible=${res.visible})`);
  for (const sel of expected) assert(res.visible.includes(sel), `[${label}] missing ${sel}`);
  assert(res.keyHit && res.stage.w >= 94 && res.stage.h >= 75, `[${label}] instrument is too small or obstructed: ${JSON.stringify(res.stage)}`);
  assert(
    res.collisions.length === 0,
    `[${label}] geometry intersections detected:\n${res.collisions.map((c) => `  ${c.a} × ${c.b}: ${c.area}px² (${JSON.stringify(c.rectA)} vs ${JSON.stringify(c.rectB)})`).join('\n')}`
  );
}

/** The clicker must never sit under HUD / dock / sheet / tips / top bar. */
async function assertStageClear(page, label) {
  // the stage glides to its new frame after chrome changes; wait until it is stable
  let stage = await rect(page, '[data-testid="fallback-stage"]');
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(120);
    const next = await rect(page, '[data-testid="fallback-stage"]');
    const same = next && stage && Math.abs(next.x - stage.x) < 0.5 && Math.abs(next.y - stage.y) < 0.5 && Math.abs(next.w - stage.w) < 0.5;
    stage = next;
    if (same) break;
  }
  assert(stage && stage.w >= 180 && stage.h >= 140, `[${label}] clicker too small: ${JSON.stringify(stage)}`);
  for (const sel of ['.counter-readout', '.bottom-dock', '.customize-sheet', '.onboarding-card', '.brand-pill', '.top-bar-actions', '.daily-pill']) {
    const o = await rect(page, sel);
    if (!o || o.w === 0) continue;
    const visible = await page.evaluate((s) => {
      const el = document.querySelector(s);
      return !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    }, sel);
    if (!visible) continue;
    const area = overlapArea(stage, o);
    if (area > 24) {
      const dbg = await page.evaluate(() => ({ frame: window.__thockFrame, vw: innerWidth, vh: innerHeight, cls: document.querySelector('.app-shell').className }));
      console.log('DEBUG overlap', label, sel, JSON.stringify({ stage, o, dbg }));
    }
    assert(area <= 24, `[${label}] clicker overlaps ${sel} by ${Math.round(area)} px²`);
  }
  return stage;
}

async function assertNoOverflow(page, label) {
  const res = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bad = [];
    const scrollers = '.sheet-body, .shelf-grid, .ach-list, .settings-list';
    for (const el of document.querySelectorAll('button, [role="button"], input, .counter-readout, .toast-pill, .modal-card')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest(scrollers)) continue; // may legitimately scroll inside its panel
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
        bad.push(`${el.getAttribute('data-testid') || el.className || el.tagName} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
      }
    }
    return { bad, sw: document.documentElement.scrollWidth, vw };
  });
  assert(res.sw <= res.vw + 1, `[${label}] horizontal overflow ${res.sw} > ${res.vw}`);
  assert(res.bad.length === 0, `[${label}] controls outside viewport: ${res.bad.join(' | ')}`);
}

/** Every visible interactive control on touch layouts is at least 44×44 CSS px. */
async function assertTapTargets(page, label) {
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role="button"], input[type="range"], a[href]')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
  assert(small.length === 0, `[${label}] tap targets < 44px: ${small.join(' | ')}`);
}

/** Text inside these elements must not be clipped/ellipsized. */
async function assertNotTruncated(page, selector, label) {
  const bad = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)]
      .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.textContent.trim()} (${el.scrollWidth}>${el.clientWidth})`);
  }, selector);
  assert(bad.length === 0, `[${label}] truncated text in ${selector}: ${bad.join(', ')}`);
}

/** Verify key HUD/chrome elements do not collide with each other. */
async function assertNoChromeCollisions(page, label) {
  const pairs = [
    ['.brand-pill', '.daily-pill'],
    ['.brand-pill', '.counter-readout'],
    ['.daily-pill', '.counter-readout'],
    ['.counter-readout', '.top-bar-actions'],
    ['.bottom-dock', '.customize-sheet'],
    ['.counter-readout', '.customize-sheet'],
    ['.counter-readout', '[data-testid="milestone-banner"]'],
    ['.brand-pill', '[data-testid="milestone-banner"]'],
  ];
  for (const [aSel, bSel] of pairs) {
    const res = await page.evaluate(
      ([sA, sB]) => {
        const vis = (s) => {
          const el = document.querySelector(s);
          if (!el) return null;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return null;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return null;
          return { x: r.left, y: r.top, r: r.right, b: r.bottom };
        };
        const a = vis(sA);
        const b = vis(sB);
        if (!a || !b) return { area: 0 };
        const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
        const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
        return { area: w > 0 && h > 0 ? w * h : 0, a, b };
      },
      [aSel, bSel]
    );
    assert(res.area === 0, `[${label}] chrome collision ${aSel} vs ${bSel}: ${Math.round(res.area)}px² (${JSON.stringify(res)})`);
  }
}

/** Scroll a sheet/modal container all the way to the bottom; assert last item is fully visible & page behind stays locked. */
async function assertScrollToBottom(page, scrollerSel, lastItemSel, label, { afterSwipe = false } = {}) {
  const info = await page.evaluate(
    ([sSel, lSel, swiped]) => {
      const scroller = document.querySelector(sSel);
      if (!scroller) return { err: `missing scroller ${sSel}` };
      const cs = getComputedStyle(scroller);
      const beforeWinY = window.scrollY;
      if (!swiped) scroller.scrollTop = scroller.scrollHeight;
      const afterWinY = window.scrollY;
      const items = scroller.querySelectorAll(lSel);
      const last = items[items.length - 1];
      if (!last) return { err: `missing last item ${lSel}` };
      const sr = scroller.getBoundingClientRect();
      const lr = last.getBoundingClientRect();
      const x = lr.left + lr.width / 2;
      const y = lr.top + lr.height / 2;
      const hit = [[x, y], [x, lr.top + 3], [x, lr.bottom - 3], [lr.left + 3, y], [lr.right - 3, y]]
        .every(([x, y]) => last.contains(document.elementFromPoint(x, y)));
      return {
        overscroll: cs.overscrollBehaviorY || cs.overscrollBehavior,
        overflowY: cs.overflowY,
        beforeWinY,
        afterWinY,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        scrollTop: scroller.scrollTop,
        sr: { t: sr.top, b: sr.bottom },
        lr: { t: lr.top, b: lr.bottom },
        vh: window.visualViewport?.height ?? window.innerHeight,
        hit,
      };
    },
    [scrollerSel, lastItemSel, afterSwipe]
  );
  assert(!info.err, `[${label}] ${info.err}`);
  assert(info.beforeWinY === 0 && info.afterWinY === 0, `[${label}] background scrolled (${info.beforeWinY} -> ${info.afterWinY})`);
  assert(/contain|none/.test(info.overscroll), `[${label}] overscroll-behavior should contain: ${info.overscroll}`);
  assert(info.scrollHeight - info.scrollTop - info.clientHeight <= 1, `[${label}] scroller reached its end: ${JSON.stringify(info)}`);
  assert(info.lr.t >= info.sr.t - 1 && info.lr.b <= info.sr.b + 1 && info.lr.b <= info.vh + 1 && info.hit,
    `[${label}] last item fully visible and hit-testable: ${JSON.stringify(info)}`);
}

const counter = async (page) => parseInt((await page.locator('[data-testid="click-counter"] .counter-number').innerText()).replace(/[^0-9]/g, ''), 10);
async function waitForCount(page, count) {
  try {
    await page.waitForFunction((expected) => {
      const number = document.querySelector('.counter-number')?.textContent;
      return Number(number?.replace(/[^0-9]/g, '')) === expected;
    }, count, { timeout: 3000 });
  } catch {
    throw new Error(`Expected ${count} clicks, got ${await counter(page)}`);
  }
}
const decodeHash = (hash) => (hash.split('b=')[1] || '').split('.');

async function pressClicker(page, mobile) {
  const box = await page.locator('[data-testid="fallback-clicker"]').boundingBox();
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.42;
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y, { delay: 10 });
}

// ───────────────────────────────────────── suites ─────────────────────────────────────────

async function suiteStatic(browser) {
  const ctx = await browser.newContext();
  const r = await ctx.request;
  for (const p of ['/manifest.webmanifest', '/favicon.svg', '/robots.txt', '/sw.js', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/icon-maskable-192.png', '/apple-touch-icon.png', '/og.png', '/404.html']) {
    const res = await r.get(BASE_URL + p);
    assert(res.status() === 200, `${p} → ${res.status()}`);
    if (p === '/og.png') {
      const len = (await res.body()).length;
      assert(len <= 250 * 1024, `og.png too big: ${len}`);
    }
    if (p === '/sw.js') {
      const body = await res.text();
      assert(/\/assets\/index-[\w-]+\.js/.test(body) && /\/assets\/three-[\w-]+\.js/.test(body), 'sw.js does not precache built JS');
      assert(/woff2/.test(body) && /\.css/.test(body), 'sw.js does not precache CSS/fonts');
      const cc = res.headers()['cache-control'] || '';
      if (!LOCAL) assert(/no-cache|no-store/.test(cc), `sw.js cache-control: ${cc}`);
    }
  }
  const manifest = await (await r.get(BASE_URL + '/manifest.webmanifest')).json();
  assert(manifest.icons.some((i) => i.purpose === 'maskable'), 'no maskable icon');
  assert(!manifest.icons.some((i) => /any maskable|maskable any/.test(i.purpose || '')), 'icon mixes any+maskable');
  const html = await (await r.get(BASE_URL + '/')).text();
  assert(html.includes('og:image') && html.includes('twitter:card'), 'missing social meta');
  const nf = await r.get(BASE_URL + '/nonexistent-route-qa');
  // (vite preview serves the SPA for unknown routes; Cloudflare Pages serves 404.html with 404)
  if (!LOCAL) assert(nf.status() === 404 && (await nf.text()).includes('Missing Keycap'), `unknown route should 404, got ${nf.status()}`);
  await ctx.close();
}

async function suiteGeometry(browser) {
  const viewports = [
    { width: 360, height: 640, isMobile: true, hasTouch: true, tag: '360x640' },
    { width: 390, height: 844, isMobile: true, hasTouch: true, tag: '390x844' },
    { width: 667, height: 375, isMobile: true, hasTouch: true, tag: '667x375' },
    { width: 768, height: 1024, isMobile: false, hasTouch: true, tag: '768x1024' },
    { width: 1024, height: 768, isMobile: false, hasTouch: false, tag: '1024x768' },
    { width: 1280, height: 800, isMobile: false, hasTouch: false, tag: '1280x800' },
    { width: 1440, height: 900, isMobile: false, hasTouch: false, tag: '1440x900' },
  ];

  for (const vp of viewports) {
    const opts = { viewport: { width: vp.width, height: vp.height }, hasTouch: vp.hasTouch };
    if (vp.isMobile) {
      opts.isMobile = true;
      opts.deviceScaleFactor = 2;
    }
    if (ENGINE === 'webkit') opts.userAgent = IPHONE_UA;
    const label = `geom-${vp.tag}`;
    const { ctx, page, errors } = await open(browser, opts, label);
    const act = (id) => {
      const button = page.getByTestId(id);
      return vp.hasTouch ? button.tap() : button.click();
    };
    const toast = page.getByTestId('toast-item');
    const milestone = '[data-testid="milestone-banner"]';
    const combo = '.combo-pill.is-visible';

    // 1. Play mode with onboarding + initial 2D toast
    await assertStageClear(page, `geom-${vp.tag}-play-hints`);
    await assertNoOverflow(page, `geom-${vp.tag}-play-hints`);
    await assertFullGeometryMatrix(page, `${label}-play-hints`, ['.onboarding-card']);

    // Dismiss onboarding, test Play mode with active combo + toast, then 25× milestone + toast
    await act('onboarding-skip-btn');
    await assertStageClear(page, `geom-${vp.tag}-play`);

    for (let i = 0; i < 4; i++) await pressClicker(page, vp.hasTouch);
    await act('save-shelf-btn');
    await toast.filter({ hasText: 'Saved to Shelf (1/12)' }).waitFor();
    await assertFullGeometryMatrix(page, `${label}-play-combo-toast`, [combo]);

    // Push through to 25× milestone in Play mode + simultaneous toast
    for (let i = 0; i < 21; i++) await pressClicker(page, vp.hasTouch);
    await page.locator(milestone).waitFor();
    await act('share-btn');
    await toast.waitFor();
    await assertFullGeometryMatrix(page, `${label}-play-milestone-toast`, [milestone]);

    // 2. Customize mode with Switch of the Day (longest label), active combo, 25× milestone, and queued toasts
    await act('mode-customize-btn');
    await page.locator('[data-testid="customize-sheet"]').waitFor();
    await act('switch-option-daily');
    await assertStageClear(page, `geom-${vp.tag}-customize-daily`);
    await assertNoOverflow(page, `geom-${vp.tag}-customize-daily`);

    // Wait for combo window to reset so we can cleanly trigger a fresh 25× milestone in Customize mode
    await page.waitForTimeout(1700);
    for (let i = 0; i < 4; i++) await pressClicker(page, vp.hasTouch);
    await act('save-shelf-btn');
    await toast.filter({ hasText: 'Saved to Shelf (2/12)' }).waitFor();
    await assertFullGeometryMatrix(page, `${label}-customize-combo-toast`, [combo, '.customize-sheet']);

    // Reach 25× milestone in Customize mode and immediately queue 2 toasts (Save + Share)
    for (let i = 0; i < 21; i++) await pressClicker(page, vp.hasTouch);
    await page.locator(milestone).waitFor();
    await page.evaluate(() => {
      const lane = document.querySelector('[data-testid="toast-lane"]');
      window.__actionToasts = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const item of record.addedNodes) {
            if (item instanceof HTMLElement && item.dataset.testid === 'toast-item') {
              window.__actionToasts.push(item.textContent);
            }
          }
        }
      });
      observer.observe(lane, { childList: true });
    });
    await act('save-shelf-btn');
    await page.getByRole('button', { name: 'Open Shelf (3 saved builds)' }).waitFor();
    await act('share-btn');
    await toast.waitFor();
    await assertFullGeometryMatrix(page, `${label}-customize-milestone-toast`, [milestone, '.customize-sheet']);
    if (ENGINE === 'chromium') {
      await shot(page, `${label}-customize-milestone-toast`);
    }
    // Saving can be acknowledged before the following tap returns, especially
    // on WebKit. Check the visible lane's sequence from before the Save tap.
    try {
      await page.waitForFunction(() => {
        const messages = window.__actionToasts;
        const save = messages.indexOf('Saved to Shelf (3/12)');
        return save >= 0 && messages.slice(save + 1).some((message) => /Share link/i.test(message));
      }, null, { timeout: 9000 });
    } catch {
      const messages = await page.evaluate(() => window.__actionToasts);
      throw new Error(`[${label}] expected Save 3 then Share in the lane, got ${JSON.stringify(messages)}`);
    }
    await assertFullGeometryMatrix(page, `${label}-customize-queued-share`);

    // 3. m3 check: .shelf-grid retains var(--safe-bottom) padding on portrait phones (≤ 600 px)
    if (vp.width <= 600) {
      await page.tap('[data-testid="shelf-btn"]');
      await page.locator('[data-testid="shelf-modal"]').waitFor();
      const padCheck = await page.evaluate(() => {
        const grid = document.querySelector('.shelf-grid');
        const before = parseFloat(getComputedStyle(grid).paddingBottom);
        document.documentElement.style.setProperty('--safe-bottom', '20px');
        const after = parseFloat(getComputedStyle(grid).paddingBottom);
        document.documentElement.style.removeProperty('--safe-bottom');
        return { before, after };
      });
      assert(
        Math.abs(padCheck.after - padCheck.before - 20) < 1,
        `[geom-${vp.tag}] .shelf-grid dropped var(--safe-bottom): before=${padCheck.before}, after=${padCheck.after}`
      );
      await page.tap('[data-testid="close-shelf-btn"]');
    }

    await page.waitForLoadState('networkidle');
    await ctx.close();
    assert(errors.length === 0, `geom-${vp.tag} errors:\n${errors.join('\n')}`);
  }
}

const mobileOptions = (width, height) => ({
  viewport: { width, height },
  isMobile: true,
  hasTouch: true,
  userAgent: ENGINE === 'webkit' ? IPHONE_UA : undefined,
});

async function suiteBreakpoints(browser) {
  const milestone = '[data-testid="milestone-banner"]';
  const combo = '.combo-pill.is-visible';
  const extras = [[390, 420], [600, 700], [601, 700], [1023, 650], [1024, 560], [1280, 560]];
  const widths = Array.from({ length: 33 }, (_, index) => 320 + index * 40);
  const matrix = [420, 650, 900].flatMap((height) => widths.map((width) => [width, height]));
  const failures = [];

  for (const mode of ['play', 'customize']) {
    const ctx = await browser.newContext({ ...mobileOptions(720, 900), reducedMotion: 'reduce' });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const errors = guard(page, `breakpoints-${mode}`);
    await page.clock.install();
    await page.goto(BASE_URL + '/');
    await page.getByTestId('onboarding-skip-btn').tap();
    if (mode === 'customize') {
      await page.getByTestId('mode-customize-btn').tap();
      await page.getByTestId('switch-option-daily').tap();
    }
    // Advance past the initial notices before holding the test states across resizes.
    await page.clock.pauseAt(new Date(Date.now() + 10_000));
    const waitForLayout = () => page.evaluate(() => new Promise((done) => {
      const observer = new ResizeObserver(() => {
        observer.disconnect();
        done();
      });
      observer.observe(document.querySelector('.stage-viewport'));
    }));
    const sweep = async (status) => {
      for (const [width, height] of [...matrix, ...extras]) {
        await page.setViewportSize({ width, height });
        await waitForLayout();
        const label = `breakpoints-${mode}-${width}x${height}-${status}`;
        try {
          if (mode === 'customize' && width < 600 && height <= 560) {
            await assertScrollToBottom(page, '.sheet-body', '.option-card', label);
          } else await assertFullGeometryMatrix(page, label, [
            status === 'milestone' ? milestone : combo,
            ...(mode === 'customize' ? ['.customize-sheet'] : []),
          ]);
          if (mode === 'customize' && status === 'milestone' && extras.some(([w, h]) => w === width && h === height) &&
              (ENGINE === 'chromium' || width === 390)) {
            await shot(page, `round5-${ENGINE}-${width}x${height}-customize`);
          }
        } catch (error) {
          failures.push(error.message);
        }
      }
    };

    for (let i = 0; i < 2; i++) await pressClicker(page, true);
    await page.getByTestId('share-btn').tap();
    await page.getByTestId('toast-item').filter({ hasText: /Share link/ }).waitFor();
    const timeAtShare = await page.evaluate(() => performance.now());
    if (ENGINE === 'chromium') await sweep('combo');
    else await assertFullGeometryMatrix(page, `breakpoints-${mode}-webkit-combo`, [combo]);
    assert(await page.evaluate(() => performance.now()) === timeAtShare, 'simulated geometry clock stays paused');
    await page.setViewportSize({ width: 720, height: 900 });
    await waitForLayout();
    for (let i = 0; i < 23; i++) await pressClicker(page, true);
    await page.locator(milestone).waitFor();
    await sweep('milestone');

    if (mode === 'customize') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: 420 });
        visualViewport.dispatchEvent(new Event('resize'));
      });
      await waitForLayout();
      const shellHeight = await page.getByTestId('app-shell').evaluate((el) => el.getBoundingClientRect().height);
      assert(shellHeight === 420, 'stage resizes when only the visual viewport shrinks');
      await assertScrollToBottom(page, '.sheet-body', '.option-card', 'keyboard-visual-viewport');
    }
    await ctx.close();
    assert(!errors.length, errors.join('\n'));
    console.log(`    ${mode} breakpoint sweep complete`);
  }
  assert(!failures.length, failures.slice(0, 20).join('\n') + (failures.length > 20 ? `\n… ${failures.length} failed cases total` : ''));
  console.log('    geometry swept 99 matrix and 6 adjacent viewport sizes in Play and Customize');
}

async function suiteRound5(browser) {
  const viewport = mobileOptions(667, 375);
  const ctx = await browser.newContext({ ...viewport, reducedMotion: 'reduce', timezoneId: 'UTC' });
  await ctx.addInitScript(INIT);
  await ctx.addInitScript(() => {
    if (!/^https?:$/.test(location.protocol)) return;
    sessionStorage.setItem('thock-lab:2d-notice', '1');
    if (localStorage.getItem('thock-lab:v1')) return;
    const build = { switchType: 'thock', keycapColor: '#E85D3F', keycapShape: 'square', baseMaterial: 'wood', keycapFinish: 'matte', charm: 'cat' };
    const shelf = Array.from({ length: 12 }, (_, i) => ({ id: `slot-${i}`, name: `Build ${i + 1}`, build }));
    localStorage.setItem('thock-lab:v1', JSON.stringify({
      currentBuild: { ...build, keycapShape: 'constructor', switchType: '__proto__', charm: 'toString' },
      shelf, hintsDismissed: true,
      settings: { reducedMotion: true },
    }));
  });
  const page = await ctx.newPage();
  const errors = guard(page, 'round5');
  await page.clock.setFixedTime(new Date('2026-11-23T12:00:00Z'));
  await page.goto(BASE_URL + '/');
  const byId = (id) => page.getByTestId(id);
  const tap = (id) => byId(id).tap();

  // B1: corrupted storage and an invalid hash sent while a valid build is already open.
  await byId('fallback-clicker').waitFor();
  assert(await page.locator('.counter-switch').textContent() === 'Deep Thock', 'storage switch sanitized');
  await page.evaluate(() => { location.hash = 'b=1.bb.0.rd.6CC7B8.gl.wd.ch'; });
  await page.waitForFunction(() => document.querySelector('.counter-switch').textContent === 'Bubble Pop');
  await page.evaluate(() => { location.hash = 'b=1.th.0.__proto__.E85D3F.mt.wd.ct'; });
  await byId('toast-item').filter({ hasText: 'share link is incomplete' }).waitFor();
  assert(await page.locator('.counter-switch').textContent() === 'Bubble Pop' && !new URL(page.url()).hash, 'invalid navigation retains the last build and clears the hash');

  // B2: test the whole hit target and its icon before tapping the actual Delete control.
  for (const inset of [0, 22]) {
    await page.evaluate((inset) => document.documentElement.style.setProperty('--safe-bottom', `${inset}px`), inset);
    await tap('shelf-btn');
    const clip = await page.evaluate(() => {
      const scroller = document.querySelector('.shelf-grid');
      scroller.scrollTop = scroller.scrollHeight;
      const bounds = scroller.getBoundingClientRect();
      return [...document.querySelectorAll('.shelf-delete-btn')].slice(-3).map((button) => {
        const rect = button.getBoundingClientRect();
        const icon = button.querySelector('svg').getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          w: rect.width, h: rect.height, top: rect.top, clipTop: bounds.top, bottom: rect.bottom, clipBottom: bounds.bottom,
          horizontallyInside: rect.left >= bounds.left && rect.right <= bounds.right,
          iconVisible: icon.top >= bounds.top && icon.bottom <= bounds.bottom &&
            icon.left >= bounds.left && icon.right <= bounds.right,
          reachable: hit?.closest('.shelf-delete-btn') === button,
          atBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 1,
          pageY: window.scrollY,
        };
      });
    });
    for (const slot of clip) assert(slot.w >= 44 && slot.h >= 44 && slot.top >= slot.clipTop && slot.bottom <= slot.clipBottom && slot.horizontallyInside && slot.iconVisible && slot.reachable && slot.atBottom && !slot.pageY, `last Shelf row at inset ${inset}: ${JSON.stringify(slot)}`);
    if (inset === 22) {
      await shot(page, `round5-${ENGINE}-shelf-landscape-bottom`);
      await byId('shelf-delete-btn').last().tap();
      await page.getByRole('button', { name: 'Save current build to slot 12', exact: true }).waitFor({ timeout: 5000 });
      assert(await byId('shelf-slot-filled').count() === 11, 'last slot deleted from bottom of Shelf');
    }
    await tap('close-shelf-btn');
  }
  await page.evaluate(() => document.documentElement.style.removeProperty('--safe-bottom'));

  // M3 and m2: scroll Switch to the end, then follow both pointer and keyboard tabs.
  await tap('mode-customize-btn');
  for (const tab of ['keycap', 'base', 'charm', 'switch']) {
    await page.evaluate(() => { const body = document.querySelector('.sheet-body'); body.scrollTop = body.scrollHeight; });
    await tap(`tab-${tab}`);
    assert(await page.locator('.sheet-body').evaluate((el) => el.scrollTop) === 0, `${tab} opens at its own top`);
  }
  await byId('tab-switch').focus();
  for (const [key, tab] of [['ArrowRight', 'keycap'], ['End', 'charm'], ['ArrowRight', 'switch'], ['ArrowLeft', 'charm'], ['Home', 'switch']]) {
    await page.keyboard.press(key);
    assert(await byId(`tab-${tab}`).getAttribute('aria-selected') === 'true', `${key} selects ${tab}`);
    assert(await page.locator('[role=tab][tabindex="0"]').count() === 1, 'only the selected tab is in the Tab order');
    assert(await byId(`tab-${tab}`).evaluate((button) => {
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      return document.activeElement === button && !panel.hidden && panel.getAttribute('aria-labelledby') === button.id;
    }), `${tab} focus and panel associations`);
  }

  // m3: title is fully laid out even with the stem and 2.6 mm label in the compact card.
  await assertScrollToBottom(page, '.sheet-body', '.option-card', 'round5-arcade');
  await assertNotTruncated(page, '[data-testid="switch-option-arcade"] .option-title', 'round5-arcade');
  assert(await byId('switch-option-arcade').locator('.option-title').textContent() === 'Retro Arcade', 'arcade title');
  await shot(page, `round5-${ENGINE}-arcade-landscape`);

  // m4: cover every daily recipe across consecutive calendar offers, and the actual selected tab.
  const offers = new Set();
  for (let day = 1; day <= 28 && offers.size < 7; day++) {
    await page.clock.setFixedTime(new Date(Date.UTC(2026, 10, day, 12)));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const colors = await page.evaluate(() => {
      const measure = (selector) => {
        const { color, backgroundColor } = getComputedStyle(document.querySelector(selector));
        const luminance = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number).map((channel, i) => {
          const s = channel / 255;
          return (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
        }).reduce((sum, value) => sum + value, 0);
        const [lo, hi] = [luminance(color), luminance(backgroundColor)].sort((a, b) => a - b);
        return (hi + 0.05) / (lo + 0.05);
      };
      return [document.querySelector('.daily-card-title').textContent, measure('.daily-card-badge'), measure('.sheet-tab.is-active')];
    });
    assert(colors[1] >= 4.5 && colors[2] >= 4.5, `color contrast ${colors}`);
    offers.add(colors[0]);
  }
  assert(offers.size === 7, `all daily badge variants covered: ${[...offers]}`);

  // m5: zero is muted, and the speaker restores the last audible volume after reload.
  await tap('settings-btn');
  await byId('volume-slider').fill('0.37');
  await byId('volume-slider').fill('0');
  assert(await byId('toggle-mute').getAttribute('aria-checked') === 'true', 'zero volume is muted');
  await page.waitForLoadState('networkidle');
  await page.reload();
  await byId('fallback-clicker').waitFor();
  await page.getByRole('button', { name: 'Unmute sound' }).tap();
  await tap('settings-btn');
  assert(await byId('volume-slider').inputValue() === '0.37' && await byId('toggle-mute').getAttribute('aria-checked') === 'false', 'speaker restored 37%');
  await tap('close-settings-btn');

  // m1: fast Dice rolls coalesce and Share is acknowledged immediately.
  await page.evaluate(() => {
    const die = document.querySelector('[data-testid="dice-btn"]');
    for (let i = 0; i < 13; i++) die.click();
  });
  const latest = await page.locator('.counter-switch').textContent();
  const rollNotice = await byId('toast-item').textContent();
  assert(rollNotice?.endsWith(latest) && rollNotice.startsWith('Rolled'), `only the latest roll is displayed: ${rollNotice} vs ${latest}`);
  await tap('share-btn');
  const confirmation = byId('toast-item').filter({ hasText: /Share link/ });
  await confirmation.waitFor({ timeout: 1000 });
  assert(await byId('share-btn').getAttribute('data-confirmed') === 'true', 'Share control confirms the action');
  await page.waitForTimeout(1450);
  assert(await byId('toast-item').filter({ hasText: /^Rolled/ }).count() === 0, 'stale rolls do not return');
  await page.waitForLoadState('networkidle');
  await ctx.close();
  assert(!errors.length, errors.join('\n'));

  // M1: stable recipe across the real share and Shelf flows, including the synthesizer's filter.
  const dailyContext = async (day, url) => {
    const dailyCtx = await browser.newContext({ ...mobileOptions(390, 844), reducedMotion: 'reduce', timezoneId: 'UTC' });
    await dailyCtx.addInitScript(INIT);
    if (ENGINE === 'chromium') await dailyCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const dailyPage = await dailyCtx.newPage();
    const dailyErrors = guard(dailyPage, `daily-${day}`);
    await dailyPage.clock.setFixedTime(new Date(`2026-11-${day}T12:00:00Z`));
    await dailyPage.goto(url);
    await dailyPage.getByTestId('fallback-clicker').waitFor();
    await dailyPage.getByTestId('onboarding-skip-btn').tap();
    return { dailyCtx, dailyPage, dailyErrors };
  };
  const audioRecipe = (page) => page.evaluate(() => window.__audioFilters
    .filter((f) => f.type === 'peaking' && Math.abs(f.Q.value - 1.8) < 0.0001)
    .map((f) => [f.frequency.value, f.gain.value]));
  const sender = await dailyContext(23, BASE_URL + '/');
  await sender.dailyPage.getByTestId('daily-switch-pill').tap();
  assert(await sender.dailyPage.locator('.counter-switch').textContent() === 'Cream Soda Linear', 'day 23 selected recipe');
  const sound = await audioRecipe(sender.dailyPage);
  assert(sound.length === 1 && Math.abs(sound[0][0] - 457.6) < 0.001 && sound[0][1] === 3, `daily recipe actually reached the audio graph: ${sound}`);
  await sender.dailyPage.getByTestId('save-shelf-btn').tap();
  await sender.dailyPage.getByRole('button', { name: /Open Shelf \(1 saved build/ }).waitFor();
  await sender.dailyPage.getByTestId('share-btn').tap();
  const sharedUrl = sender.dailyPage.url();
  if (ENGINE === 'chromium') assert(await sender.dailyPage.evaluate(() => navigator.clipboard.readText()) === sharedUrl, 'daily link copied');
  assert(sharedUrl.includes('#b=2.ln.cream-linear.'), `daily recipe encoded: ${sharedUrl}`);
  const savedState = await sender.dailyPage.evaluate(() => JSON.parse(localStorage.getItem('thock-lab:v1')));
  assert(savedState.shelf[0].thumbnail.startsWith('data:image/jpeg') && savedState.shelf[0].build.dailyVariantId === 'cream-linear', 'Shelf stores the resolved recipe and thumbnail');
  await sender.dailyPage.waitForLoadState('networkidle');
  await sender.dailyCtx.close();
  assert(!sender.dailyErrors.length, sender.dailyErrors.join('\n'));

  const receiver = await dailyContext(24, sharedUrl);
  const rp = receiver.dailyPage;
  assert((await rp.getByTestId('daily-switch-pill').textContent()).includes('Velvet Raindrop'), 'day 24 exposes the new daily offer');
  assert(rp.url() === sharedUrl && await rp.locator('.counter-switch').textContent() === 'Cream Soda Linear', 'fresh share remains the same on day 24');
  await pressClicker(rp, true);
  assert(JSON.stringify(await audioRecipe(rp)) === JSON.stringify(sound), 'day 24 playback uses the same daily sound');
  if (!LOCAL) {
    await rp.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  }
  await rp.evaluate((state) => {
    state.currentBuild = { ...state.currentBuild, dailyVariantId: null, switchType: 'thock' };
    localStorage.setItem('thock-lab:v1', JSON.stringify(state));
    history.replaceState(null, '', '/');
  }, savedState);
  await rp.reload();
  await rp.getByTestId('shelf-btn').tap();
  const card = rp.getByTestId('shelf-slot-filled');
  assert((await card.locator('.shelf-switch').textContent()).includes('Cream Soda Linear'), 'saved slot still shows the correct recipe');
  await card.locator('.shelf-slot-main').tap();
  assert(await rp.locator('.counter-switch').textContent() === 'Cream Soda Linear', 'Shelf playback remains pinned');
  assert(JSON.stringify(await audioRecipe(rp)) === JSON.stringify(sound), 'Shelf restored the identical sound');
  await rp.waitForLoadState('networkidle');
  await receiver.dailyCtx.close();
  assert(!receiver.dailyErrors.length, receiver.dailyErrors.join('\n'));
}

async function assertContrast(page, selector) {
  const ratios = await page.locator(selector).evaluateAll((elements) => {
    const rgba = (color) => {
      const [r, g, b, a = 1] = color.match(/[\d.]+/g).map(Number);
      return { channels: [r, g, b], alpha: a };
    };
    const composite = (fg, bg) => fg.channels.map((value, i) => value * fg.alpha + bg[i] * (1 - fg.alpha));
    const luminance = (channels) => channels.reduce((sum, value, i) => {
      const s = value / 255;
      return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
    }, 0);
    return elements.map((el) => {
      const layers = [];
      for (let node = el; node; node = node.parentElement) {
        const layer = rgba(getComputedStyle(node).backgroundColor);
        layers.unshift(layer);
        if (layer.alpha === 1) break;
      }
      const background = layers.reduce((bg, fg) => composite(fg, bg), [255, 255, 255]);
      const foreground = composite(rgba(getComputedStyle(el).color), background);
      const [lo, hi] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      return (hi + 0.05) / (lo + 0.05);
    });
  });
  assert(ratios.length && ratios.every((ratio) => ratio >= 4.5),
    `${selector} meets 4.5:1: ${ratios.map((ratio) => ratio.toFixed(2))}`);
  return Math.min(...ratios).toFixed(2);
}

async function swipeToEnd(page, cdp, selector) {
  const scroller = page.locator(selector);
  const atEnd = () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop <= 1);
  const { x, y, width, height } = await scroller.boundingBox();
  const px = Math.round(x + width / 2);
  const send = (type, py) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: py === undefined ? [] : [{ x: px, y: Math.round(py) }],
  });
  for (let swipe = 0; swipe < 12; swipe++) {
    if (await atEnd()) return;
    await send('touchStart', y + height - 12);
    for (let step = 1; step <= 8; step++) {
      await send('touchMove', y + height - 12 - (height - 24) * step / 8);
    }
    await send('touchEnd');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
  }, selector, { timeout: 2000 });
}

async function suiteRound6(browser) {
  const opts = mobileOptions(390, 844);
  if (ENGINE === 'chromium') {
    opts.userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Telegram-Android/11.0';
  }
  const label = `round6-${ENGINE}`;
  const { ctx, page, errors } = await open(browser, opts, label);
  page.setDefaultTimeout(10_000);
  const clicker = page.getByRole('button', { name: 'Thock Lab clicker (2D mode). Press to click.' });
  const filled = (p, slot) => p.locator(`[data-slot="${slot}"]`);
  const empty = (p, slot) => p.getByRole('button', { name: `Save current build to slot ${slot}`, exact: true });
  const tap = (p, id) => p.getByTestId(id).tap();
  await tap(page, 'onboarding-skip-btn');
  await page.keyboard.press('Tab');
  await clicker.focus();
  assert(await clicker.evaluate((el) => el.tagName === 'BUTTON' && el.matches(':focus-visible')), 'fallback has a visibly focused native button');
  await clicker.dispatchEvent('click');
  await waitForCount(page, 1);
  await shot(page, `${label}-fallback-focus`);
  for (const [key, count] of [['Space', 2], ['Enter', 3]]) {
    await page.keyboard.down(key);
    await waitForCount(page, count);
    await page.keyboard.down(key);
    await page.keyboard.up(key);
    assert(await counter(page) === count, `${key} repeats and release do not add a press`);
  }
  await clicker.tap();
  await waitForCount(page, 4);
  await clicker.click();
  await waitForCount(page, 5);

  const other = await ctx.newPage();
  other.setDefaultTimeout(10_000);
  const otherErrors = guard(other, `${label}-second-tab`);
  await other.goto(BASE_URL + '/#b=1.bb.0.rd.6CC7B8.gl.wd.ch');
  await tap(other, 'shelf-btn');
  await empty(other, 12).tap();
  await filled(other, 12).getByRole('button', { name: /Load saved build.*Bubble Pop/ }).waitFor();
  await empty(other, 1).waitFor();
  await other.getByTestId('toast-item').filter({ hasText: 'Saved to Shelf (1/12)' }).waitFor();
  await clicker.tap();
  await waitForCount(other, 6);
  await page.getByRole('button', { name: /Open Shelf \(1 saved build/ }).waitFor();
  await other.waitForLoadState('networkidle');
  await other.reload();
  await tap(other, 'shelf-btn');
  await filled(other, 12).waitFor();
  await empty(other, 1).waitFor();
  await tap(page, 'shelf-btn');
  await Promise.all([empty(page, 1).tap(), empty(other, 2).tap()]);
  for (const p of [page, other]) {
    for (const slot of [1, 2, 12]) await filled(p, slot).waitFor();
  }
  const shelfContrast = await assertContrast(page, '.primary-pill-btn, .shelf-meta .shelf-tags, .shelf-meta .shelf-switch, .shelf-slot.is-empty');
  await tap(page, 'close-shelf-btn');
  await Promise.all([clicker.tap(), filled(other, 12).getByTestId('shelf-delete-btn').tap()]);
  await empty(other, 12).waitFor();
  await waitForCount(page, 7);
  await tap(other, 'close-shelf-btn');
  await Promise.all([pressClicker(page, true), pressClicker(other, true)]);
  await Promise.all([waitForCount(page, 9), waitForCount(other, 9)]);
  await other.waitForLoadState('networkidle');
  await other.reload();
  await tap(other, 'shelf-btn');
  await empty(other, 12).waitFor();
  assert(await other.getByTestId('shelf-slot-filled').count() === 2, 'only the two retained positions survive reload');
  assert((await page.locator('.counter-switch').textContent()) === 'Deep Thock', 'other tabs keep their own active build');
  await other.close();
  assert(!otherErrors.length, otherErrors.join('\n'));

  await tap(page, 'settings-btn');
  const settingsContrast = await assertContrast(page, '.shortcut-note, .setting-desc');
  await tap(page, 'close-settings-btn');
  await tap(page, 'mode-customize-btn');
  await tap(page, 'tab-keycap');
  await tap(page, 'finish-option-glow');
  const chipContrast = await assertContrast(page, '.chip-btn');
  await page.getByRole('button', { name: 'Close customizer' }).tap();
  console.log(`    ${label} concurrent saves, deletes and clicks survived reload; minimum contrast Shelf ${shelfContrast}:1, Settings ${settingsContrast}:1, chips ${chipContrast}:1`);

  const cdp = ENGINE === 'chromium' ? await ctx.newCDPSession(page) : null;
  const cases = [
    [390, 420, 420, 0], [390, 340, 340, 22],
    [390, 844, 420, 0], [390, 844, 420, 22], [390, 844, 340, 22],
    [667, 375, 225, 22], [667, 225, 225, 22], [844, 390, 225, 22],
  ];
  for (const [width, height, visible, inset] of cases) {
    await page.setViewportSize({ width, height });
    await page.evaluate(([height, visible, inset]) => {
      document.documentElement.style.setProperty('--safe-bottom', `${inset}px`);
      delete visualViewport.height;
      if (visible !== height) Object.defineProperty(visualViewport, 'height', { configurable: true, value: visible });
      visualViewport.dispatchEvent(new Event('resize'));
    }, [height, visible, inset]);
    await page.waitForFunction((height) => Math.abs(document.querySelector('.app-shell').clientHeight - height) <= 1, visible);
    await tap(page, 'mode-customize-btn');
    const tag = `${label}-${width}x${height}v${visible}-inset${inset}`;
    const body = page.locator('.sheet-body');
    assert(await body.evaluate((el, inset) => parseFloat(getComputedStyle(el).paddingBottom) >= inset + 8, inset),
      `${tag} Customize keeps its bottom safe area`);
    for (const [tab, id] of Object.entries({
      switch: 'switch-option-arcade', keycap: 'finish-option-glow', base: 'base-option-plastic', charm: 'charm-option-dice',
    })) {
      await tap(page, `tab-${tab}`);
      const afterSwipe = !!cdp && (visible === 225 || visible === 420 && inset === 22);
      if (afterSwipe) await swipeToEnd(page, cdp, '.sheet-body');
      await assertScrollToBottom(page, '.sheet-body', `[data-testid="${id}"]`, `${tag}-${tab}`, { afterSwipe });
      if (height === 844 && inset === 22 && tab === 'base') await shot(page, tag, { x: 0, y: 0, width, height: visible });
      const box = await page.getByTestId(id).boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      assert(await page.getByTestId(id).getAttribute('aria-pressed') === 'true', `${tag} taps the final ${tab} option`);
    }
    await assertNoOverflow(page, tag);
    await page.getByRole('button', { name: 'Close customizer' }).tap();
  }
  // Reuse the two real saves as fixture builds so the last occupied row lands
  // at the bottom even under a simulated landscape keyboard.
  await page.evaluate(() => {
    const key = 'thock-lab:v1';
    const state = JSON.parse(localStorage.getItem(key));
    state.shelf = Array.from({ length: 12 }, (_, i) => ({ ...state.shelf[i % 2], slot: i + 1, id: `fixture-${i}` }));
    localStorage.setItem(key, JSON.stringify(state));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
  await tap(page, 'shelf-btn');
  if (cdp) await swipeToEnd(page, cdp, '.shelf-grid');
  await assertScrollToBottom(page, '.shelf-grid', '.shelf-delete-btn', `${label}-short-landscape-shelf`, { afterSwipe: !!cdp });
  await shot(page, `${label}-short-landscape-shelf`, { x: 0, y: 0, width: 844, height: 225 });
  await filled(page, 12).getByTestId('shelf-delete-btn').tap();
  await empty(page, 12).waitFor();
  await cdp?.detach();
  await ctx.close();
  assert(!errors.length, errors.join('\n'));
}

async function suiteRound7Audio(browser, pointerType) {
  const label = `round7-${ENGINE}-${pointerType}`;
  const touch = pointerType.startsWith('touch');
  const keyboard = pointerType === 'keyboard';
  const backdropFirst = pointerType === 'touch-after-backdrop';
  const ctx = await browser.newContext({
    ...(touch ? mobileOptions(390, 844) : { viewport: { width: 1440, height: 900 } }),
    reducedMotion: 'reduce',
  });
  try {
    await ctx.addInitScript(INIT);
    await ctx.addInitScript(() => {
      if (location.origin === 'null') return;
      localStorage.setItem('thock-lab:v1', JSON.stringify({ hintsDismissed: true }));
      const probe = window.__strokeProbe = { strokes: [], contexts: 0 };
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (time) {
        probe.strokes.at(-1)?.oscillatorStarts.push({ time, calledAt: this.context.currentTime });
        return start.call(this, time);
      };
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (target, ...args) {
        const audio = this.context;
        if (target === audio.destination) {
          probe.contexts++;
          const analyser = audio.createAnalyser();
          // Cover gaps in main-thread timer delivery while the audio thread
          // renders independently, including during touch input processing.
          analyser.fftSize = 32768;
          connect.call(this, analyser);
          const buffer = new Float32Array(analyser.fftSize);
          probe.capture = () => {
            const stroke = probe.strokes.at(-1);
            if (!stroke || audio.state !== 'running') return;
            analyser.getFloatTimeDomainData(buffer);
            const now = audio.currentTime;
            const at = (clock) => Math.max(0, Math.min(buffer.length, Math.round(buffer.length - (now - clock) * audio.sampleRate)));
            const boundary = stroke.releaseClock === undefined ? buffer.length : at(stroke.releaseClock);
            for (let i = at(stroke.pressClock); i < buffer.length; i++) {
              const side = i < boundary ? 'held' : 'released';
              stroke[side] = Math.max(stroke[side], Math.abs(buffer[i]));
            }
          };
          probe.audio = audio;
        }
        return connect.call(this, target, ...args);
      };
      const press = (event, input) => {
        probe.strokes.push({
          input, pointerId: event.pointerId, trusted: event.isTrusted,
          activation: navigator.userActivation?.hasBeenActive,
          cold: !probe.audio || probe.audio.currentTime === 0, held: 0, released: 0,
          pressClock: probe.audio?.currentTime ?? 0, oscillatorStarts: [],
        });
      };
      const release = (event, input) => {
        const stroke = probe.strokes.at(-1);
        if (stroke && stroke.releaseClock === undefined && stroke.input === input && stroke.pointerId === event.pointerId) {
          stroke.releaseClock = probe.audio?.currentTime ?? 0;
          stroke.startedBeforeRelease = stroke.oscillatorStarts.length;
          stroke.trustedRelease = event.isTrusted;
        }
      };
      window.addEventListener('pointerdown', (event) => {
        if (event.target.closest('[data-testid="fallback-clicker"]')) press(event, event.pointerType);
      }, true);
      window.addEventListener('pointerup', (event) => release(event, event.pointerType), true);
      window.addEventListener('pointercancel', (event) => {
        const stroke = probe.strokes.at(-1);
        if (stroke?.pointerId === event.pointerId) stroke.canceled = true;
      }, true);
      window.addEventListener('lostpointercapture', (event) => {
        const stroke = probe.strokes.at(-1);
        if (stroke?.pointerId === event.pointerId) stroke.captureLost = true;
      }, true);
      window.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && !event.repeat) press(event, 'keyboard');
      }, true);
      window.addEventListener('keyup', (event) => {
        if (event.code === 'Space') release(event, 'keyboard');
      }, true);
    });
    const page = await ctx.newPage();
    const errors = guard(page, label);
    await page.goto(BASE_URL + '/');
    const wkPage = ENGINE === 'webkit' ? page._connection.toImpl(page).delegate : null;
    const session = wkPage ? wkPage._pageProxySession : await ctx.newCDPSession(page);
    // Playwright's public evaluate methods grant a user gesture in both engines.
    // Resolve the hit point and read the probe without pre-activating the page.
    const read = async (expression) => {
      const target = wkPage ? wkPage._session : session;
      const { result } = await target.send('Runtime.evaluate', { expression, returnByValue: true });
      return result.value;
    };
    const hitPoint = `(() => {
      const key = document.querySelector('[data-testid="fallback-clicker"]');
      const box = key?.getBoundingClientRect();
      return box?.width > 30 ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), id: 1 } : null;
    })()`;
    let point;
    for (let attempt = 0; !point && attempt < 80; attempt++) {
      point = await read(hitPoint);
      if (!point) await page.waitForTimeout(25);
    }
    assert(point, `${label} has a press target`);
    assert(await read('window.__strokeProbe.contexts') === 0, `${label} no graph before first input`);
    assert(await read('navigator.userActivation.hasBeenActive') === false, `${label} no prior activation`);
    const state = () => read('(window.__strokeProbe.capture?.(), window.__strokeProbe.strokes)');
    const waitForProbe = async (expression, message) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await read(expression)) return;
        await page.waitForTimeout(25);
      }
      throw new Error(`${label} ${message}`);
    };

    if (backdropFirst) {
      const backdrop = await read(`(() => {
        const box = document.querySelector('[data-testid="fallback-clicker"]').getBoundingClientRect();
        return [
          [Math.round(box.x + box.width / 2), Math.round(box.y - 24)],
          [4, Math.round(box.y + box.height / 2)],
        ].find(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit?.closest('.stage-viewport') && !hit.closest('button');
        }) ?? null;
      })()`);
      assert(backdrop, `${label} has an unobstructed backdrop target`);
      await page.touchscreen.tap(...backdrop);
      await waitForProbe('window.__strokeProbe.audio?.currentTime > 0', 'backdrop tap unlocks audio');
      assert((await state()).length === 0, `${label} backdrop is outside the clicker`);
    }
    const down = touch
      ? () => session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      : keyboard
        ? () => page.keyboard.down('Space')
        : async () => { await page.mouse.move(point.x, point.y); await page.mouse.down(); };
    const up = touch
      ? () => session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: wkPage ? [point] : [] })
      : keyboard ? () => page.keyboard.up('Space') : () => page.mouse.up();

    const input = touch ? 'touch' : pointerType;
    for (let i = 0; i < (backdropFirst ? 1 : 2); i++) {
      const coldTouch = touch && !backdropFirst && i === 0;
      if (coldTouch && wkPage) {
        // WebKit's split touch protocol delivers pointerup without tap activation.
        // Its complete trusted tap exercises the browser's release-time activation.
        await page.touchscreen.tap(point.x, point.y);
      } else {
        await down();
        if (coldTouch) {
          await page.waitForTimeout(220);
          const holding = (await state())[i];
          assert(holding?.releaseClock === undefined && holding?.held === 0,
            `${label} the first held touch stays silent before activation`);
        } else {
          await waitForProbe(
            '(window.__strokeProbe.capture?.(), window.__strokeProbe.strokes.at(-1)?.held > 0.15)',
            'downstroke emits samples while the input is held',
          );
          const holding = (await state())[i];
          assert(holding?.trusted && holding.input === input && holding.releaseClock === undefined
            && holding.oscillatorStarts.length === 2, `${label} downstroke sounds before release: ${JSON.stringify(holding)}`);
          await page.waitForTimeout(100);
        }
        await up();
      }

      if (coldTouch) {
        assert(await read('navigator.userActivation.hasBeenActive') === true, `${label} trusted release grants activation`);
      }
      await waitForProbe(
        `(window.__strokeProbe.capture?.(), window.__strokeProbe.strokes.at(-1)?.released > ${coldTouch ? 0.35 : 0.07})`,
        'release emits samples',
      );
      const stroke = (await state())[i];
      const [first, second, release] = stroke.oscillatorStarts;
      assert(stroke.trusted && stroke.trustedRelease && stroke.input === input, `${label} uses trusted ${input} events`);
      assert(stroke.cold === (!backdropFirst && i === 0), `${label} exercises the expected audio graph state`);
      assert(stroke.oscillatorStarts.length === 3 && first.time < second.time && release.time - first.time >= 0.044,
        `${label} downstroke precedes upstroke: ${JSON.stringify(stroke)}`);
      assert(stroke.oscillatorStarts.every(({ calledAt, time }) => calledAt <= time + 0.005),
        `${label} audio sources start before their envelopes elapse: ${JSON.stringify(stroke)}`);
      if (coldTouch) {
        assert(stroke.activation === false && stroke.startedBeforeRelease === 0 && stroke.released > 0.35,
          `${label} the first touch emits the downstroke only after activation on release`);
      } else {
        assert(stroke.startedBeforeRelease === 2 && stroke.held > 0.15, `${label} held downstroke emits samples`);
      }
      console.log(`    ${label} ${stroke.cold ? 'cold' : 'warm'} held=${stroke.held.toFixed(3)} released=${stroke.released.toFixed(3)}`);
      if (!backdropFirst && i === 0) await page.waitForTimeout(100);
    }

    await waitForCount(page, backdropFirst ? 1 : 2);
    assert(!errors.length, errors.join('\n'));
  } finally {
    await ctx.close();
  }
}

async function suiteRound7(browser) {
  const label = `round7-${ENGINE}`;
  const failures = [];
  const inputs = ['mouse', 'keyboard', 'touch', 'touch-after-backdrop'];
  if (ENGINE === 'webkit') inputs.unshift('mouse', 'mouse');
  for (const pointer of inputs) {
    try {
      await suiteRound7Audio(browser, pointer);
    } catch (error) {
      failures.push(error.message);
    }
  }

  const { ctx, page, errors } = await open(browser, {
    ...mobileOptions(390, 420),
    locale: 'fa-IR',
    permissions: ENGINE === 'chromium' ? ['clipboard-read', 'clipboard-write'] : undefined,
  }, label);
  try {
    const tap = (id) => page.getByTestId(id).tap();
    await tap('onboarding-skip-btn');
    await tap('share-btn');
    const confirmation = page.getByTestId('toast-item').filter({ hasText: 'Share link copied to clipboard' });
    await confirmation.waitFor({ timeout: 3500 });
    const shareUrl = page.url();
    await tap('mode-customize-btn');
    await tap('tab-switch');
    await confirmation.waitFor({ timeout: 2000 });
    const notice = await confirmation.boundingBox();
    const choices = await page.locator('.sheet-body').boundingBox();
    assert(notice.y + notice.height <= choices.y, `${label} Share confirmation is above the choices`);
    await assertScrollToBottom(page, '.sheet-body', '[data-testid="switch-option-arcade"]', `${label}-compact-share`);
    await shot(page, `${label}-compact-share`);
    await tap('close-customizer-btn');

    for (const mode of ['false', 'throw']) {
      await page.evaluate((mode) => {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          configurable: true, value: () => Promise.reject(new DOMException('Copy denied', 'NotAllowedError')),
        });
        document.execCommand = () => {
          if (mode === 'throw') throw new DOMException('Copy unsupported', 'NotSupportedError');
          return false;
        };
      }, mode);
      await tap('share-btn');
      const dialog = page.getByRole('dialog', { name: 'Share build' });
      const field = dialog.getByRole('textbox', { name: 'Share link' });
      assert(await field.inputValue() === shareUrl, `${label} manual field has the full URL`);
      assert(!(await page.getByTestId('share-btn').getAttribute('data-confirmed')), `${label} denied copy has no checkmark`);
      assert(await confirmation.count() === 0, `${label} denied copy clears an earlier confirmation`);
      await field.tap();
      const selection = await field.evaluate((el) => [el.readOnly, el.selectionStart, el.selectionEnd, el.value.length]);
      assert(selection[0] && selection[1] === 0 && selection[2] === selection[3],
        `${label} a real tap selects the full URL: ${selection}`);
      if (mode === 'false') await shot(page, `${label}-clipboard-denied`);
      await dialog.getByRole('button', { name: 'Close Share' }).tap();
      await dialog.waitFor({ state: 'detached' });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: () => new Promise((_, reject) => {
          window.__rejectShare = () => reject(new DOMException('Copy denied', 'NotAllowedError'));
        }),
      });
    });
    await tap('share-btn');
    await page.waitForFunction(() => !!window.__rejectShare);
    await tap('settings-btn');
    const settings = page.getByTestId('settings-modal').getByRole('dialog');
    const activeInSettings = () => settings.evaluate((el) => el.contains(document.activeElement));
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Tab');
      assert(await activeInSettings(), `${label} Settings owns focus while Share is pending`);
    }
    const focused = await page.evaluate(async () => {
      const before = document.activeElement;
      window.__rejectShare();
      await new Promise(requestAnimationFrame);
      return document.activeElement === before;
    });
    assert(focused && await page.getByRole('dialog').count() === 1 && await activeInSettings(),
      `${label} rejected clipboard leaves Settings and its focus intact`);
    await tap('close-settings-btn');
    const manualShare = page.getByRole('dialog', { name: 'Share build' });
    await manualShare.waitFor();
    const field = manualShare.getByRole('textbox', { name: 'Share link' });
    for (let i = 0; i < 2 && !(await field.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    assert(await field.evaluate((el) => el === document.activeElement), `${label} Tab reaches the deferred link`);
    await page.keyboard.press('Tab');
    assert(await manualShare.evaluate((el) => el.contains(document.activeElement)), `${label} Share traps focus on its own`);
    await page.keyboard.press('Escape');
    await manualShare.waitFor({ state: 'detached' });
    assert(await page.getByTestId('share-btn').evaluate((el) => el === document.activeElement),
      `${label} closing deferred Share restores focus to its opener`);

    await tap('shelf-btn');
    const empty = (slot) => page.getByRole('button', { name: `Save current build to slot ${slot}`, exact: true });
    const filled = (slot) => page.locator(`[data-slot="${slot}"]`);
    await empty(1).tap();
    await filled(1).waitFor();
    await tap('close-shelf-btn');
    await tap('mode-customize-btn');
    await tap('tab-keycap');
    await tap('shape-option-pill');
    await tap('close-customizer-btn');
    await tap('shelf-btn');
    for (let slot = 2; slot <= 12; slot++) {
      await empty(slot).tap();
      await filled(slot).waitFor();
    }
    for (const [slot, shape] of [[1, 'Square'], [3, 'Pill']]) {
      const description = `Slot ${slot}, Vermilion Pop · Deep Thock · ${shape} · Matte`;
      await filled(slot).getByRole('button', { name: `Load saved build, ${description}` }).waitFor();
      await filled(slot).getByRole('button', { name: `Delete ${description} from Shelf` }).waitFor();
      assert(await filled(slot).getByText(`Slot ${slot}`, { exact: true }).isVisible(), `${label} saved slot ${slot} number stays visible`);
    }
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-bottom', '22px');
      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 340 });
      visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => document.querySelector('.app-shell').clientHeight === 340);
    for (const slot of [11, 12]) {
      await assertScrollToBottom(page, '.shelf-grid', `[data-slot="${slot}"] .shelf-delete-btn`, `${label}-slot-${slot}`);
      await assertScrollToBottom(page, '.shelf-grid', `[data-slot="${slot}"] .shelf-slot-number`, `${label}-slot-${slot}-number`);
    }
    await shot(page, `${label}-compact-shelf`, { x: 0, y: 0, width: 390, height: 340 });
    const savedSlot = () => page.evaluate(() => JSON.parse(localStorage.getItem('thock-lab:v1')).shelf.find(({ slot }) => slot === 12));
    const originalSlot = await savedSlot();
    const target = await filled(12).getByTestId('shelf-delete-btn').boundingBox();
    await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
    await empty(12).waitFor();
    const undo = page.getByRole('dialog').getByRole('button', { name: 'Undo', exact: true });
    await undo.waitFor();
    await shot(page, `${label}-compact-shelf-undo`, { x: 0, y: 0, width: 390, height: 340 });
    await undo.tap();
    await filled(12).waitFor();
    assert(JSON.stringify(await savedSlot()) === JSON.stringify(originalSlot), `${label} Undo persists the exact build in Slot 12`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      delete visualViewport.height;
      visualViewport.dispatchEvent(new Event('resize'));
      const key = 'thock-lab:v1';
      const state = JSON.parse(localStorage.getItem(key));
      state.stats.totalClicks = 10_000;
      localStorage.setItem(key, JSON.stringify(state));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    await tap('close-shelf-btn');
    await tap('achievements-btn');
    const progress = page.getByTestId('ach-clicks-10000').locator('.ach-progress-text');
    assert((await progress.textContent()).trim() === '10,000 / 10,000', `${label} English progress uses English digits with fa-IR`);
    await assertNoOverflow(page, label);
    assert(!errors.length, errors.join('\n'));
  } catch (error) {
    failures.push(error.message);
  } finally {
    await ctx.close();
  }
  assert(!failures.length, failures.join('\n'));
}

async function suiteDesktop(browser) {
  const { ctx, page, errors } = await open(browser, { viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] }, 'desktop');
  assert((await page.locator('[data-testid="clicker-stage"]').getAttribute('data-renderer')) === '2d', 'expected 2D renderer without WebGL');
  // P1: 2D wood & aluminum patterns have solid fallback rects beneath texture images
  const patternRects = await page.evaluate(() => ({
    wood: document.querySelector('#fb-wood rect')?.getAttribute('fill'),
    alu: document.querySelector('#fb-alu rect')?.getAttribute('fill'),
  }));
  assert(patternRects.wood === '#5A3822' && patternRects.alu === '#B8BEC7', `P1 pattern fallbacks missing: ${JSON.stringify(patternRects)}`);
  await page.locator('[data-testid="onboarding-hint"]').waitFor();
  await assertStageClear(page, 'desktop-hints');
  await assertNoOverflow(page, 'desktop-hints');
  await shot(page, 'desktop-01-first-run');
  // m3: Tip 2 in 2D mode must not claim 3D orbit
  await page.click('[data-testid="onboarding-next-btn"]');
  const tip2Text = await page.locator('[data-testid="onboarding-hint"]').innerText();
  assert(!/orbit|3D/i.test(tip2Text), `2D Tip 2 should not mention 3D/orbit: ${tip2Text}`);
  await page.click('[data-testid="onboarding-next-btn"]');
  await page.click('[data-testid="onboarding-next-btn"]');
  assert((await page.locator('[data-testid="onboarding-hint"]').count()) === 0, 'tips should close after 3');

  // Click streak → counter, combo, 25× milestone (P1: milestone hides combo pill cleanly), sound
  for (let i = 0; i < 5; i++) await pressClicker(page, false);
  await page.locator('[data-testid="combo-meter"].is-visible').waitFor();
  for (let i = 0; i < 21; i++) await pressClicker(page, false);
  await waitForCount(page, 26);
  await page.locator('[data-testid="milestone-banner"]').waitFor();
  const comboOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="combo-meter"]')).opacity));
  assert(comboOpacity === 0, `combo pill should be hidden under milestone banner, opacity=${comboOpacity}`);
  const audio = await page.evaluate(() => window.__audioStats);
  assert(audio.contexts === 1 && audio.oscillators > 26 && audio.sources > 26, `no synthesis: ${JSON.stringify(audio)}`);
  await assertStageClear(page, 'desktop-combo');
  await shot(page, 'desktop-02-combo');

  // m1/m4: Space clicks after pointer-clicking a button, BUT Tab→Space immediately (<600ms) activates the focused button
  await page.click('[data-testid="mode-customize-btn"]');
  await page.click('[data-testid="mode-play-btn"]');
  const before = await counter(page);
  await page.keyboard.press('Space');
  await waitForCount(page, before + 1);
  assert((await page.locator('[data-testid="customize-sheet"]').count()) === 0, 'Space re-triggered a button');

  // m4 regression: click Play, immediately Tab to Customize (<600ms), press Space → opens Customize without clicking keycap
  await page.click('[data-testid="mode-play-btn"]');
  await page.keyboard.press('Tab');
  const focusedId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  assert(focusedId === 'mode-customize-btn', `expected Tab to focus mode-customize-btn, got ${focusedId}`);
  const beforeTabSpace = await counter(page);
  await page.keyboard.press('Space');
  await page.locator('[data-testid="customize-sheet"]').waitFor();
  assert((await counter(page)) === beforeTabSpace, 'Tab+Space within 600ms stole Space from keyboard-focused button');
  await page.click('[data-testid="mode-play-btn"]');

  // Customize: every switch + daily (aria-pressed)
  await page.click('[data-testid="mode-customize-btn"]');
  await page.locator('[data-testid="customize-sheet"]').waitFor();
  await assertStageClear(page, 'desktop-customize');
  for (const sw of ['clicky', 'tactile', 'linear', 'bubble', 'arcade', 'thock']) await page.click(`[data-testid="switch-option-${sw}"]`);
  await page.click('[data-testid="switch-option-daily"]');
  assert((await page.getAttribute('[data-testid="switch-option-daily"]', 'aria-pressed')) === 'true', 'daily card aria-pressed');
  await shot(page, 'desktop-03-customize-switch');
  await page.click('[data-testid="tab-keycap"]');
  await page.click('[data-testid="shape-option-tall-artisan"]');
  await page.click('[data-testid="color-option-A996E8"]');
  await page.click('[data-testid="finish-option-frosted"]');
  await shot(page, 'desktop-04-customize-keycap');
  await page.click('[data-testid="tab-base"]');
  await page.click('[data-testid="base-option-acrylic"]');
  await shot(page, 'desktop-05-customize-base');
  await page.click('[data-testid="tab-charm"]');
  await page.click('[data-testid="charm-option-ghost"]');
  assert((await page.locator('.charm-card svg').count()) === 7, 'charm cards should show SVG charm art');
  // P1: the desktop drawer hugs its content (no big empty panel)
  const sheet = await rect(page, '.customize-sheet');
  const lastCard = await rect(page, '.charm-card:last-child');
  assert(sheet.b - lastCard.b < 60, `charm panel leaves ${Math.round(sheet.b - lastCard.b)}px empty`);
  await shot(page, 'desktop-06-customize-charm');

  // Save + share + snapshot
  await page.getByTestId('shelf-btn').click();
  await page.getByRole('button', { name: 'Save current build to slot 12', exact: true }).click();
  await page.locator('[data-slot="12"] .shelf-slot-main').waitFor();
  await page.getByRole('button', { name: 'Save current build to slot 1', exact: true }).waitFor();
  await page.locator('[data-testid="toast-item"]', { hasText: 'Saved to Shelf (1/12)' }).waitFor();
  await page.getByTestId('close-shelf-btn').click();
  await page.click('[data-testid="share-btn"]');
  await page.waitForFunction(() => location.hash.startsWith('#b=2.'));
  const sharedUrl = page.url();
  const parts = decodeHash(sharedUrl);
  assert(parts[3] === 'ta' && parts[4] === 'A996E8' && parts[5] === 'fr' && parts[6] === 'ac' && parts[7] === 'gh', `share hash wrong: ${sharedUrl}`);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip === sharedUrl, 'clipboard should hold the share link');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="snapshot-btn"]')]);
  const snapPath = path.join(QA, 'snapshot-2d.png');
  await download.saveAs(snapPath);
  const png = fs.readFileSync(snapPath);
  assert(png[0] === 0x89 && png[1] === 0x50 && png.readUInt32BE(16) === 1080 && png.readUInt32BE(20) === 1080, 'snapshot must be a 1080² PNG');
  assert(png.length <= 300 * 1024, `snapshot too big: ${png.length}`);

  // m2: hash follows daily toggle, dice and shelf loads
  await page.click('[data-testid="daily-switch-pill"]');
  await page.waitForFunction(() => location.hash.split('.')[2] === '0');
  await page.click('[data-testid="dice-btn"]');
  await page.click('[data-testid="save-shelf-btn"]');
  await page.locator('[data-testid="toast-item"]', { hasText: 'Saved to Shelf (2/12)' }).waitFor();
  const diceHash = page.url().split('#')[1];

  // Shelf: focus trap (m4), load restores hash
  await page.click('[data-testid="mode-play-btn"]');
  await page.click('[data-testid="shelf-btn"]');
  await page.locator('[data-testid="shelf-modal"]').waitFor();
  assert((await page.locator('[data-testid="shelf-slot-filled"]').count()) === 2, 'shelf should have 2 builds');
  assert((await page.locator('.shelf-thumb').count()) === 2, 'shelf thumbnails missing');
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press(i % 5 === 4 ? 'Shift+Tab' : 'Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    assert(inside, 'focus escaped the open dialog');
  }
  // P1: circular focus ring on shelf delete button
  const delRadius = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="shelf-delete-btn"]')).borderRadius));
  assert(delRadius >= 20, `shelf-delete-btn should have circular radius, got ${delRadius}`);
  await shot(page, 'desktop-07-shelf');
  await page.keyboard.press('Escape');
  assert((await page.locator('[data-testid="shelf-modal"]').count()) === 0, 'Escape closes shelf');
  assert((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'shelf-btn', 'focus should return to the Shelf button');
  await page.click('[data-testid="shelf-btn"]');
  await page.locator('[data-slot="12"] .shelf-slot-main').click();
  await page.waitForFunction((h) => location.hash.slice(1) !== h, diceHash);
  assert(decodeHash(page.url())[7] === 'gh', `hash should follow the loaded shelf build: ${page.url()}`);

  // Achievements + settings (m3: no Reset Camera or 3D orbit tip in 2D mode) + persistence
  await page.click('[data-testid="achievements-btn"]');
  await page.locator('[data-testid="achievements-modal"]').waitFor();
  assert((await page.getAttribute('[data-testid="ach-all-switches"]', 'class')).includes('is-unlocked'), 'Switch Connoisseur should unlock');
  await shot(page, 'desktop-08-achievements');
  await page.click('[data-testid="close-achievements-btn"]');
  await page.click('[data-testid="settings-btn"]');
  await page.locator('[data-testid="settings-modal"]').waitFor();
  assert((await page.locator('[data-testid="renderer-note"]').innerText()).includes('2D'), 'renderer note');
  assert((await page.locator('[data-testid="reset-camera-btn"]').count()) === 0, 'Reset Camera should be hidden in 2D mode');
  const shortcutText = await page.locator('[data-testid="shortcut-note"]').innerText();
  assert(!/orbit|Double-tap/i.test(shortcutText), `2D shortcut note should not mention orbit: ${shortcutText}`);
  await page.click('[data-testid="toggle-reduced-motion"]');
  await shot(page, 'desktop-09-settings');
  await page.click('[data-testid="close-settings-btn"]');
  // m3: Space after mouse-closing a modal must click the keycap, NOT reopen the modal
  const beforeModalSpace = await counter(page);
  await page.keyboard.press('Space');
  assert((await page.locator('[data-testid="settings-modal"]').count()) === 0, 'm3: Space reopened Settings modal after mouse close');
  await waitForCount(page, beforeModalSpace + 1);
  const total = await counter(page);
  await page.reload({ waitUntil: 'load' });
  await page.locator('[data-testid="fallback-clicker"]').waitFor();
  await page.waitForTimeout(350);
  assert((await counter(page)) === total, 'clicks persist');
  assert((await page.locator('[data-testid="onboarding-hint"]').count()) === 0, 'tips stay dismissed');
  await page.click('[data-testid="settings-btn"]');
  assert((await page.getAttribute('[data-testid="toggle-reduced-motion"]', 'aria-checked')) !== null, 'settings toggle');
  await page.click('[data-testid="close-settings-btn"]');
  await ctx.close();

  // Share link round trip in a fresh context
  const friend = await open(browser, { viewport: { width: 1440, height: 900 } }, 'desktop-friend', sharedUrl);
  await friend.page.click('[data-testid="mode-customize-btn"]');
  await friend.page.click('[data-testid="tab-keycap"]');
  for (const sel of ['shape-option-tall-artisan', 'finish-option-frosted', 'color-option-A996E8']) {
    assert((await friend.page.getAttribute(`[data-testid="${sel}"]`, 'aria-pressed')) === 'true', `round trip ${sel}`);
  }
  await friend.page.click('[data-testid="tab-base"]');
  assert((await friend.page.getAttribute('[data-testid="base-option-acrylic"]', 'aria-pressed')) === 'true', 'round trip base');
  await friend.page.click('[data-testid="tab-charm"]');
  assert((await friend.page.getAttribute('[data-testid="charm-option-ghost"]', 'aria-pressed')) === 'true', 'round trip charm');
  await friend.ctx.close();

  const all = [...errors, ...friend.errors];
  assert(all.length === 0, `desktop errors:\n${all.join('\n')}`);
}

async function suiteTablet(browser) {
  const label = 'tablet-768x1024';
  const { ctx, page, errors } = await open(browser, { viewport: { width: 768, height: 1024 }, hasTouch: true }, label);
  await page.locator('[data-testid="onboarding-hint"]').waitFor();
  // m2: initial 2D toast on tablet 601–1023 px must sit clear of Counter HUD
  await assertToastClear(page, `${label}-first-run-toast`);
  await assertNoChromeCollisions(page, `${label}-first-run`);
  await assertNoOverflow(page, `${label}-first-run`);
  await shot(page, `${label}-01-toast`);
  await page.click('[data-testid="onboarding-skip-btn"]');
  await page.click('[data-testid="dice-btn"]');
  await page.locator('[data-testid="toast-item"]', { hasText: 'Rolled' }).waitFor();
  await assertToastClear(page, `${label}-dice-toast`);
  await page.click('[data-testid="shelf-btn"]');
  await page.locator('[data-testid="shelf-modal"]').waitFor();
  await page.click('[data-testid="shelf-save-current-btn"]');
  await page.locator('[data-testid="toast-item"]', { hasText: 'Saved to Shelf' }).waitFor();
  await assertToastClear(page, `${label}-modal-toast`, { allowTopBar: true });
  await page.click('[data-testid="close-shelf-btn"]');
  await ctx.close();
  assert(errors.length === 0, `${label} errors:\n${errors.join('\n')}`);
}

async function suiteMobile(browser, { width, height, label, checkMilestone = false }) {
  const opts = { viewport: { width, height }, isMobile: true, hasTouch: true, acceptDownloads: true };
  if (ENGINE === 'chromium') opts.deviceScaleFactor = 2;
  const { ctx, page, errors } = await open(browser, opts, label);
  await page.locator('[data-testid="onboarding-hint"]').waitFor();
  await assertStageClear(page, `${label}-hints`);
  await assertNoOverflow(page, `${label}-hints`);
  await assertNoChromeCollisions(page, `${label}-hints`);
  await assertTapTargets(page, `${label}-hints`);
  // M2: initial 2D notice toast in Play mode must not cover TopBar, Daily Pill, Counter HUD, or Onboarding card
  await assertToastClear(page, `${label}-first-run-toast`);
  await shot(page, `${label}-01-first-run`);
  await page.tap('[data-testid="onboarding-skip-btn"]');
  // M9: lower the volume BEFORE the first tap → the very first stroke must already be quiet
  await page.tap('[data-testid="settings-btn"]');
  await page.locator('[data-testid="volume-slider"]').fill('0.1');
  await page.tap('[data-testid="close-settings-btn"]');
  for (let i = 0; i < 6; i++) await pressClicker(page, true);
  await waitForCount(page, 6);
  const firstGain = await page.evaluate(() => window.__audioStats.master && window.__audioStats.master.gain.value);
  assert(Math.abs(firstGain - 0.1) < 0.02, `first-tap master gain should be 0.1, was ${firstGain}`);
  await assertStageClear(page, `${label}-play`);
  await shot(page, `${label}-02-play`);

  await page.tap('[data-testid="mode-customize-btn"]');
  await page.locator('[data-testid="customize-sheet"]').waitFor();
  await page.waitForTimeout(350);
  const tabLastItem = { switch: '.option-card', keycap: '.chip-btn', base: '.base-card', charm: '.charm-card' };
  for (const tab of ['switch', 'keycap', 'base', 'charm']) {
    await page.tap(`[data-testid="tab-${tab}"]`);
    await page.waitForTimeout(120);
    await assertStageClear(page, `${label}-customize-${tab}`);
    await assertNoOverflow(page, `${label}-customize-${tab}`);
    await assertNoChromeCollisions(page, `${label}-customize-${tab}`);
    await assertTapTargets(page, `${label}-customize-${tab}`);
    await assertNotTruncated(page, '.sheet-tab', `${label}-${tab}`);
    if (tab === 'switch') await assertNotTruncated(page, '.option-title', `${label}-switch`);
    // all four tabs fully inside the sheet header, not under the header buttons
    const tabs = await rect(page, '.sheet-tabs');
    const actions = await rect(page, '.sheet-header-actions');
    const charmTab = await rect(page, '[data-testid="tab-charm"]');
    assert(charmTab.r <= tabs.r + 1 && charmTab.r <= actions.x + 1, `${label}: Charm tab clipped`);
    // §1c scroll check: scroll every Customize tab all the way to the bottom
    await assertScrollToBottom(page, '.sheet-body', tabLastItem[tab], `${label}-sheet-${tab}`);
    await shot(page, `${label}-03-customize-${tab}`);
  }
  await page.tap('[data-testid="tab-switch"]');
  // m1: reach 25× milestone while Customize is open and verify zero overlap with counter readout
  if (checkMilestone) {
    for (let i = 0; i < 25; i++) await pressClicker(page, true);
    await page.locator('[data-testid="milestone-banner"]').waitFor();
    await assertNoChromeCollisions(page, `${label}-customize-milestone25`);
    await shot(page, `${label}-03c-customize-milestone25`);
  }
  await page.tap('[data-testid="tab-keycap"]');
  await page.tap('[data-testid="shape-option-round"]');
  await page.tap('[data-testid="color-option-6CC7B8"]');
  await page.tap('[data-testid="finish-option-glossy"]');
  await page.tap('[data-testid="tab-charm"]');
  await page.tap('[data-testid="charm-option-cherry"]');
  // M2: Toast while customizing must not cover TopBar, Counter HUD, or the customize sheet
  await page.tap('[data-testid="save-shelf-btn"]');
  const toast = page.locator('[data-testid="toast-item"]', { hasText: 'Saved to Shelf' });
  await toast.waitFor();
  await assertToastClear(page, `${label}-customize-toast`);
  await shot(page, `${label}-03b-customize-toast`);

  // Snapshot downloads (2D path) on touch too
  const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('[data-testid="snapshot-btn"]')]);
  const p = path.join(QA, `snapshot-${label}.png`);
  await dl.saveAs(p);
  const png = fs.readFileSync(p);
  assert(png.readUInt32BE(16) === 1080 && png.length <= 300 * 1024, `${label} snapshot ${png.length}`);
  fs.unlinkSync(p);

  await page.tap('[data-testid="mode-play-btn"]');
  await page.tap('[data-testid="shelf-btn"]');
  await page.locator('[data-testid="shelf-modal"]').waitFor();
  await page.waitForTimeout(250);
  await assertNoOverflow(page, `${label}-shelf`);
  await assertTapTargets(page, `${label}-shelf`);
  await assertScrollToBottom(page, '.shelf-grid', '.shelf-slot', `${label}-shelf-scroll`);
  await shot(page, `${label}-04-shelf`);
  // Toast inside an open modal stays clear of the dialog
  await page.tap('[data-testid="shelf-save-current-btn"]');
  const t2 = page.locator('[data-testid="toast-item"]', { hasText: 'Saved to Shelf (2/12)' });
  await t2.waitFor();
  await assertToastClear(page, `${label}-modal-toast`, { allowTopBar: true });
  await page.tap('[data-testid="close-shelf-btn"]');

  await page.tap('[data-testid="achievements-btn"]');
  await page.locator('[data-testid="achievements-modal"]').waitFor();
  await assertTapTargets(page, `${label}-ach`);
  await assertNoOverflow(page, `${label}-ach`);
  await assertScrollToBottom(page, '.ach-list', '.ach-row', `${label}-ach-scroll`);
  await page.tap('[data-testid="close-achievements-btn"]');

  await page.tap('[data-testid="settings-btn"]');
  await page.locator('[data-testid="settings-modal"]').waitFor();
  await assertTapTargets(page, `${label}-settings`);
  await assertNoOverflow(page, `${label}-settings`);
  await assertScrollToBottom(page, '.settings-list', '.shortcut-note', `${label}-settings-scroll`);
  await shot(page, `${label}-05-settings`);
  await page.tap('[data-testid="close-settings-btn"]');
  await ctx.close();

  // m1: normal-motion onboarding entrance must stay horizontally centered inside viewport mid-animation
  if (width === 390 && height === 844) {
    const animCtx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference', deviceScaleFactor: 2 });
    await animCtx.addInitScript(INIT);
    const animPage = await animCtx.newPage();
    const animErrors = guard(animPage, `${label}-anim`);
    await animPage.goto(BASE_URL + '/', { waitUntil: 'load' });
    await animPage.locator('[data-testid="onboarding-hint"]').waitFor({ state: 'visible', timeout: 20000 });
    await animPage.waitForTimeout(40);
    const obRect = await rect(animPage, '.onboarding-card');
    assert(obRect && obRect.x >= -1 && obRect.r <= width + 1, `[${label}] onboarding-card jumped off-screen mid-animation: ${JSON.stringify(obRect)}`);
    await animCtx.close();
    errors.push(...animErrors);
  }
  assert(errors.length === 0, `${label} errors:\n${errors.join('\n')}`);
}

async function suiteLandscape(browser, { width = 844, height = 390, label = 'landscape-844x390' } = {}) {
  const { ctx, page, errors } = await open(browser, { viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, label);
  await page.locator('[data-testid="onboarding-hint"]').waitFor();
  await assertStageClear(page, `${label}-hints`);
  await assertNoOverflow(page, `${label}-hints`);
  await assertNoChromeCollisions(page, `${label}-hints`);
  await assertTapTargets(page, `${label}-hints`);
  // M2: initial 2D notice toast in Play mode must not cover TopBar, Daily Pill, Counter HUD, or Onboarding card
  await assertToastClear(page, `${label}-first-run-toast`);
  await shot(page, `${label}-01-first-run`);
  await page.tap('[data-testid="onboarding-skip-btn"]');
  for (let i = 0; i < 3; i++) await pressClicker(page, true);
  await waitForCount(page, 3);
  // M2: landscape Play toast clear of TopBar & Counter HUD
  await page.tap('[data-testid="dice-btn"]');
  await page.locator('[data-testid="toast-item"]', { hasText: 'Rolled' }).waitFor();
  await assertToastClear(page, `${label}-play-toast`);
  await assertNoChromeCollisions(page, `${label}-play`);
  await page.tap('[data-testid="mode-customize-btn"]');
  await page.locator('[data-testid="customize-sheet"]').waitFor();
  await page.waitForTimeout(300);
  // M1: Play button must be 100% inside viewport and dock/counter/sheet/brand must never collide
  const playRect = await rect(page, '[data-testid="mode-play-btn"]');
  assert(playRect && playRect.x >= 4 && playRect.r <= width - 4, `[${label}] Play button clipped: ${JSON.stringify(playRect)}`);
  await assertNoChromeCollisions(page, `${label}-customize`);
  // M2: landscape Customize toast clear of TopBar, Counter HUD & Customize sheet
  await page.tap('[data-testid="save-shelf-btn"]');
  await page.locator('[data-testid="toast-item"]', { hasText: 'Saved to Shelf' }).waitFor();
  await assertToastClear(page, `${label}-customize-toast`);
  await shot(page, `${label}-02b-customize-toast`);
  const tabLastItem = { switch: '.option-card', keycap: '.chip-btn', base: '.base-card', charm: '.charm-card' };
  for (const tab of ['switch', 'keycap', 'base', 'charm']) {
    await page.tap(`[data-testid="tab-${tab}"]`);
    await page.waitForTimeout(100);
    const stage = await assertStageClear(page, `${label}-customize-${tab}`);
    assert(stage.w >= 180, `${label}: clicker should stay prominent beside the drawer (${stage.w})`);
    await assertNoOverflow(page, `${label}-customize-${tab}`);
    await assertNoChromeCollisions(page, `${label}-customize-${tab}`);
    await assertTapTargets(page, `${label}-customize-${tab}`);
    await assertNotTruncated(page, '.sheet-tab', `${label}-${tab}`);
    await assertScrollToBottom(page, '.sheet-body', tabLastItem[tab], `${label}-sheet-${tab}`);
    await shot(page, `${label}-02-customize-${tab}`);
  }
  // m1: 25× milestone in landscape Customize must not overlap Counter HUD or Brand pill
  for (let i = 0; i < 25; i++) await pressClicker(page, true);
  await page.locator('[data-testid="milestone-banner"]').waitFor();
  await assertNoChromeCollisions(page, `${label}-customize-milestone25`);
  await shot(page, `${label}-03-customize-milestone`);

  await page.tap('[data-testid="charm-option-star"]');
  assert((await page.getAttribute('[data-testid="charm-option-star"]', 'aria-pressed')) === 'true', 'landscape charm pick');

  // §1c scroll check on all modals in landscape
  await page.tap('[data-testid="shelf-btn"]');
  await page.locator('[data-testid="shelf-modal"]').waitFor();
  await assertNoOverflow(page, `${label}-shelf`);
  await assertScrollToBottom(page, '.shelf-grid', '.shelf-slot', `${label}-shelf-scroll`);
  await page.tap('[data-testid="close-shelf-btn"]');

  await page.tap('[data-testid="achievements-btn"]');
  await page.locator('[data-testid="achievements-modal"]').waitFor();
  await assertNoOverflow(page, `${label}-ach`);
  await assertScrollToBottom(page, '.ach-list', '.ach-row', `${label}-ach-scroll`);
  await page.tap('[data-testid="close-achievements-btn"]');

  await page.tap('[data-testid="settings-btn"]');
  await page.locator('[data-testid="settings-modal"]').waitFor();
  await assertNoOverflow(page, `${label}-settings`);
  await assertScrollToBottom(page, '.settings-list', '.shortcut-note', `${label}-settings-scroll`);
  await page.tap('[data-testid="close-settings-btn"]');

  await ctx.close();
  assert(errors.length === 0, `${label} errors:\n${errors.join('\n')}`);
}

async function suiteMalformed(browser) {
  const cases = [
    '#b=%E0%A4%A',
    '#b=1.constructor.0.sq.E85D3F.mt.wd.ct',
    '#b=1.th.0.constructor.E85D3F.mt.wd.ct',
    '#b=2.th.cream-linear.sq.E85D3F.mt.wd.ct',
    '#b=1.zz.0.sq.GGGGGG.mt.wd.ct',
    '#b=',
    '#b=1.th.0.sq.E85D3F.mt.wd',
    `#b=${'x'.repeat(3000)}`,
    '#b=1.th.0.sq.E85D3F.mt.wd.ct%',
  ];
  for (const hash of cases) {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 800 } }, `hash ${hash.slice(0, 24)}`, `${BASE_URL}/${hash}`);
    assert((await page.locator('[data-testid="crash-screen"]').count()) === 0, `crash screen for ${hash}`);
    await page.locator('[data-testid="toast-item"]', { hasText: 'share link is incomplete' }).waitFor({ timeout: 5000 });
    assert(!page.url().includes('#b='), `broken hash should be cleared (${page.url()})`);
    await pressClicker(page, false);
    await waitForCount(page, 1);
    assert(await page.locator('.counter-switch').textContent() === 'Deep Thock', 'fresh invalid links recover to the default build');
    if (hash === '#b=%E0%A4%A') await shot(page, 'malformed-hash-recovered');
    await ctx.close();
    assert(errors.length === 0, `malformed ${hash}:\n${errors.join('\n')}`);
  }
}

async function suiteOffline(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'allow' });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = guard(page, 'offline');
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.locator('[data-testid="fallback-clicker"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find((k) => k.startsWith('thock-lab-')));
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  assert(cached.some((p) => /\/assets\/index-.*\.js$/.test(p)) && cached.some((p) => /\.woff2$/.test(p)) && cached.includes('/'), `precache incomplete: ${cached.join(',')}`);
  // Visit a 404 online — must NOT poison the cached app shell.
  // Chromium logs a console.error for the intentional HTTP 404 document response; drop only that one.
  const errsBefore404 = errors.length;
  const nf = await page.goto(BASE_URL + '/nonexistent-route-qa', { waitUntil: 'load' });
  if (!LOCAL) assert(nf.status() === 404, 'expected 404 page');
  for (let i = errors.length - 1; i >= errsBefore404; i--) {
    if (/Failed to load resource: the server responded with a status of 404/.test(errors[i])) errors.splice(i, 1);
  }
  await ctx.setOffline(true);
  for (const url of [BASE_URL + '/', BASE_URL + '/?from=offline', BASE_URL + '/#b=1.bb.0.rd.6CC7B8.gl.wd.ch']) {
    await page.goto(url, { waitUntil: 'load' });
    await page.locator('[data-testid="fallback-clicker"]').waitFor({ timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    assert(!(await page.content()).includes('Missing Keycap'), `offline ${url} served the 404 page`);
  }
  await page.reload({ waitUntil: 'load' });
  await page.locator('[data-testid="fallback-clicker"]').waitFor();
  await page.waitForTimeout(350);
  const fontsOk = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check("700 20px 'Bricolage Grotesque Variable'");
  });
  assert(fontsOk, 'brand fonts should load offline');
  const c0 = await counter(page);
  await pressClicker(page, false);
  await waitForCount(page, c0 + 1);
  await shot(page, 'offline-reload');
  await ctx.setOffline(false);
  await ctx.close();
  assert(errors.length === 0, `offline errors:\n${errors.join('\n')}`);
}

async function suiteWebKit(browser) {
  const label = 'webkit-iphone';
  const { ctx, page, errors } = await open(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, acceptDownloads: true }, label);
  await page.locator('[data-testid="onboarding-hint"]').waitFor();
  await assertStageClear(page, `${label}-hints`);
  await assertNoOverflow(page, `${label}-hints`);
  await assertTapTargets(page, `${label}-hints`);
  // M2: initial 2D notice toast in Play mode must not cover TopBar, Daily Pill, Counter HUD, or Onboarding card
  await assertToastClear(page, `${label}-first-run-toast`);
  await shot(page, `${label}-01-first-run`);
  await page.tap('[data-testid="onboarding-skip-btn"]');
  for (let i = 0; i < 6; i++) await pressClicker(page, true);
  await waitForCount(page, 6);
  const audio = await page.evaluate(() => window.__audioStats);
  assert(audio.contexts === 1, `webkit audio context: ${JSON.stringify(audio)}`);
  await page.waitForTimeout(400); // let any audio-start rejection surface
  await shot(page, `${label}-02-play`);
  await page.tap('[data-testid="mode-customize-btn"]');
  await page.locator('[data-testid="customize-sheet"]').waitFor();
  await page.waitForTimeout(200);
  // M1: WebKit + reducedMotion must immediately apply active mode button backgrounds (no frozen transition)
  const modeBgs = await page.evaluate(() => ({
    play: getComputedStyle(document.querySelector('[data-testid="mode-play-btn"]')).backgroundColor,
    customize: getComputedStyle(document.querySelector('[data-testid="mode-customize-btn"]')).backgroundColor,
  }));
  assert(modeBgs.customize === 'rgb(31, 26, 23)' && modeBgs.play === 'rgba(0, 0, 0, 0)', `WebKit reduced-motion stalled mode buttons: ${JSON.stringify(modeBgs)}`);
  for (const tab of ['switch', 'keycap', 'base', 'charm']) {
    await page.tap(`[data-testid="tab-${tab}"]`);
    await page.waitForTimeout(120);
    await assertStageClear(page, `${label}-customize-${tab}`);
    await assertNoOverflow(page, `${label}-customize-${tab}`);
    await assertNotTruncated(page, '.sheet-tab', `${label}-${tab}`);
    await shot(page, `${label}-03-customize-${tab}`);
  }
  await page.tap('[data-testid="charm-option-dice"]');
  await page.tap('[data-testid="tab-keycap"]');
  await page.tap('[data-testid="finish-option-frosted"]');
  await page.waitForTimeout(80);
  // M1: WebKit + reducedMotion must immediately highlight Frosted Glass and un-highlight Matte
  const finBgs = await page.evaluate(() => ({
    matte: getComputedStyle(document.querySelector('[data-testid="finish-option-matte"]')).backgroundColor,
    frosted: getComputedStyle(document.querySelector('[data-testid="finish-option-frosted"]')).backgroundColor,
  }));
  assert(finBgs.frosted === 'rgb(184, 65, 40)' && finBgs.matte !== finBgs.frosted, `WebKit reduced-motion stalled finish chip: ${JSON.stringify(finBgs)}`);
  await page.tap('[data-testid="finish-option-metallic"]');
  await page.tap('[data-testid="save-shelf-btn"]');
  await page.locator('[data-testid="toast-item"]', { hasText: 'Saved to Shelf (1/12)' }).waitFor();
  await assertToastClear(page, `${label}-customize-toast`);
  await page.tap('[data-testid="share-btn"]');
  await page.waitForFunction(() => location.hash.startsWith('#b=1.'));
  const shared = page.url();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('[data-testid="snapshot-btn"]')]);
  const p = path.join(QA, 'snapshot-webkit.png');
  await dl.saveAs(p);
  const png = fs.readFileSync(p);
  assert(png.readUInt32BE(16) === 1080 && png.length <= 300 * 1024, `webkit snapshot ${png.length}`);
  fs.unlinkSync(p);
  await page.tap('[data-testid="mode-play-btn"]');
  await page.tap('[data-testid="shelf-btn"]');
  await page.locator('[data-testid="shelf-modal"]').waitFor();
  await page.waitForTimeout(250);
  // M1: WebKit + reducedMotion modal must be fully opaque (opacity === 1, not stuck at 0.9)
  const modalOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="shelf-modal"]')).opacity));
  assert(modalOpacity === 1, `WebKit reduced-motion modal stuck semi-transparent: opacity=${modalOpacity}`);
  await assertNoOverflow(page, `${label}-shelf`);
  await shot(page, `${label}-04-shelf`);
  await page.tap('[data-testid="close-shelf-btn"]');
  await ctx.close();

  // M1 + m1: WebKit normal-motion check (onboarding centered mid-animation, opaque modals, in-app Reduced Motion toggle)
  const norm = await open(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, reducedMotion: 'no-preference' }, `${label}-normal`);
  const normOb = await rect(norm.page, '.onboarding-card');
  assert(normOb && normOb.x >= -1 && normOb.r <= 391, `WebKit normal-motion onboarding off-screen: ${JSON.stringify(normOb)}`);
  await norm.page.tap('[data-testid="settings-btn"]');
  await norm.page.locator('[data-testid="settings-modal"]').waitFor();
  await norm.page.tap('[data-testid="toggle-reduced-motion"]');
  await norm.page.waitForTimeout(80);
  const rmModalOpacity = await norm.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="settings-modal"]')).opacity));
  assert(rmModalOpacity === 1, `WebKit in-app Reduced Motion modal opacity=${rmModalOpacity}`);
  await norm.page.tap('[data-testid="close-settings-btn"]');
  await norm.page.tap('[data-testid="shelf-btn"]');
  await norm.page.locator('[data-testid="shelf-modal"]').waitFor();
  const rmShelfOpacity = await norm.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="shelf-modal"]')).opacity));
  assert(rmShelfOpacity === 1, `WebKit in-app Reduced Motion shelf opacity=${rmShelfOpacity}`);
  await norm.ctx.close();

  const friend = await open(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }, `${label}-friend`, shared);
  await friend.page.tap('[data-testid="mode-customize-btn"]');
  await friend.page.tap('[data-testid="tab-charm"]');
  assert((await friend.page.getAttribute('[data-testid="charm-option-dice"]', 'aria-pressed')) === 'true', 'webkit round trip');
  await friend.ctx.close();

  const broken = await open(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }, `${label}-broken`, `${BASE_URL}/#b=%E0%A4%A`);
  await broken.page.locator('[data-testid="toast-item"]', { hasText: 'share link is incomplete' }).waitFor();
  await broken.ctx.close();

  // §1c scroll checks also cover the reduced viewport available above a phone keyboard.
  const wkExtraErrors = [];
  for (const vp of [
    { width: 360, height: 640, tag: 'wk-360x640' },
    { width: 390, height: 664, tag: 'wk-390x664' },
    { width: 667, height: 375, tag: 'wk-667x375' },
    { width: 390, height: 420, tag: 'wk-390x420-keyboard', keyboard: true },
  ]) {
    const sub = await open(browser, { viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }, vp.tag);
    await assertNoOverflow(sub.page, `${vp.tag}-play`);
    await assertNoChromeCollisions(sub.page, `${vp.tag}-play`);
    if (!vp.keyboard) await assertToastClear(sub.page, `${vp.tag}-play-toast`);
    await sub.page.tap('[data-testid="onboarding-skip-btn"]');
    await sub.page.tap('[data-testid="mode-customize-btn"]');
    await sub.page.locator('[data-testid="customize-sheet"]').waitFor();
    await sub.page.waitForTimeout(200);
    await assertNoOverflow(sub.page, `${vp.tag}-customize`);
    await assertNoChromeCollisions(sub.page, `${vp.tag}-customize`);
    for (const [tab, item] of Object.entries({ switch: '.option-card', keycap: '.chip-btn', base: '.base-card', charm: '.charm-card' })) {
      await sub.page.getByTestId(`tab-${tab}`).tap();
      await assertScrollToBottom(sub.page, '.sheet-body', item, `${vp.tag}-sheet-${tab}`);
    }
    if (vp.keyboard) await sub.page.getByRole('button', { name: 'Close customizer' }).tap();
    await sub.page.tap('[data-testid="shelf-btn"]');
    await sub.page.locator('[data-testid="shelf-modal"]').waitFor();
    await assertScrollToBottom(sub.page, '.shelf-grid', '.shelf-slot', `${vp.tag}-shelf`);
    await sub.page.tap('[data-testid="close-shelf-btn"]');
    await sub.page.tap('[data-testid="achievements-btn"]');
    await assertScrollToBottom(sub.page, '.ach-list', '.ach-row', `${vp.tag}-achievements`);
    await sub.page.tap('[data-testid="close-achievements-btn"]');
    await sub.page.tap('[data-testid="settings-btn"]');
    await sub.page.locator('[data-testid="settings-modal"]').waitFor();
    await assertScrollToBottom(sub.page, '.settings-list', '.shortcut-note', `${vp.tag}-settings`);
    await sub.page.tap('[data-testid="close-settings-btn"]');
    await sub.ctx.close();
    wkExtraErrors.push(...sub.errors);
  }

  const all = [...errors, ...norm.errors, ...friend.errors, ...broken.errors, ...wkExtraErrors];
  assert(all.length === 0, `${label} errors:\n${all.join('\n')}`);
}

async function suiteWebKitOffline(browser) {
  // setOffline(true) in headless WebKit rejects even a literal service-worker response
  // (microsoft/playwright#42775). Drop the connection to the live origin at the proxy.
  const origin = new URL(BASE_URL);
  assert(origin.protocol === 'https:', 'WebKit origin-outage check needs the live HTTPS site');
  const connections = new Set();
  let disconnected = false;
  let tunnels = 0;
  let blockedTunnels = 0;
  const proxy = http.createServer((request, response) => response.writeHead(403).end());
  proxy.on('connect', (request, client, head) => {
    if (disconnected || request.url !== `${origin.hostname}:443`) {
      if (disconnected && request.url === `${origin.hostname}:443`) blockedTunnels++;
      client.destroy();
      return;
    }
    const remote = net.connect(443, origin.hostname, () => {
      tunnels++;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote);
      remote.pipe(client);
    });
    connections.add(client);
    connections.add(remote);
    client.on('error', () => remote.destroy());
    remote.on('error', () => client.destroy());
    client.on('close', () => { connections.delete(client); remote.destroy(); });
    remote.on('close', () => { connections.delete(remote); client.destroy(); });
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  let ctx;
  try {
    ctx = await browser.newContext({
      ...mobileOptions(390, 844), reducedMotion: 'reduce', acceptDownloads: true,
      serviceWorkers: 'allow', proxy: { server: `http://127.0.0.1:${proxy.address().port}` },
    });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const errors = guard(page, 'webkit-origin-outage');
    await page.goto(BASE_URL + '/', { waitUntil: 'load', timeout: 20_000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
    await page.getByTestId('onboarding-skip-btn').tap();
    assert(tunnels > 0, 'initial visit passed through the proxy');
    const warmTunnels = tunnels;
    disconnected = true;
    for (const socket of connections) socket.destroy();
    const cached = await page.goto(BASE_URL + '/?qa=offline#b=1.bb.0.rd.6CC7B8.gl.wd.ch', { waitUntil: 'load', timeout: 20_000 });
    assert(cached?.status() === 200 && tunnels === warmTunnels && blockedTunnels > 0, 'service worker launched the live build with the origin disconnected');
    await page.getByTestId('fallback-clicker').waitFor();
    assert(await page.locator('.counter-switch').textContent() === 'Bubble Pop', 'offline shared build decoded on WebKit');
    const count = await counter(page);
    await pressClicker(page, true);
    await waitForCount(page, count + 1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('snapshot-btn').tap()]);
    const png = fs.readFileSync(await download.path());
    assert(png.readUInt32BE(16) === 1080 && png.readUInt32BE(20) === 1080, 'WebKit export works offline');
    await shot(page, 'round5-webkit-offline');
    assert(!errors.length, errors.join('\n'));
  } finally {
    await ctx?.close();
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
  }
}

// ───────────────────────────────────────── main ─────────────────────────────────────────
console.log(`Thock Lab E2E · ${ENGINE} · ${BASE_URL} · suites: ${SUITES.join(', ')}`);
const browser =
  ENGINE === 'webkit'
    ? await pw.webkit.launch()
    : await pw.chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2'] });
let failed = false;
try {
  for (const s of SUITES) {
    const t0 = Date.now();
    try {
      if (s === 'static') await suiteStatic(browser);
      else if (s === 'geometry') await suiteGeometry(browser);
      else if (s === 'breakpoints') await suiteBreakpoints(browser);
      else if (s === 'round5') await suiteRound5(browser);
      else if (s === 'round6') await suiteRound6(browser);
      else if (s === 'round7') await suiteRound7(browser);
      else if (s === 'desktop') await suiteDesktop(browser);
      else if (s === 'tablet') await suiteTablet(browser);
      else if (s === 'mobile390') await suiteMobile(browser, { width: 390, height: 844, label: 'mobile-390x844', checkMilestone: true });
      else if (s === 'mobile390x664') await suiteMobile(browser, { width: 390, height: 664, label: 'mobile-390x664' });
      else if (s === 'mobile360x640') await suiteMobile(browser, { width: 360, height: 640, label: 'mobile-360x640', checkMilestone: true });
      else if (s === 'mobile360') await suiteMobile(browser, { width: 360, height: 740, label: 'mobile-360x740' });
      else if (s === 'landscape667') await suiteLandscape(browser, { width: 667, height: 375, label: 'landscape-667x375' });
      else if (s === 'landscape') await suiteLandscape(browser, { width: 844, height: 390, label: 'landscape-844x390' });
      else if (s === 'malformed') await suiteMalformed(browser);
      else if (s === 'offline') await suiteOffline(browser);
      else if (s === 'webkit-iphone') await suiteWebKit(browser);
      else if (s === 'webkit-offline') await suiteWebKitOffline(browser);
      else throw new Error(`unknown suite ${s}`);
      passed.push(s);
      console.log(`  ✓ ${s} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed = true;
      console.log(`  ✗ ${s}: ${err.message}`);
    } finally {
      for (const ctx of browser.contexts()) await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(failed ? `\nE2E FAIL (${passed.length}/${SUITES.length} suites passed)` : `\nE2E PASS (${passed.length} suites)`);
process.exit(failed ? 1 : 0);
