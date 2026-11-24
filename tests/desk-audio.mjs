// Desk mode audio verification: true-peak ceiling (zero samples > ±1.0, peak <= 0.98)
// and preset loudness matching (~2 dB) across Chromium and WebKit against local or live BASE_URL.
//
// Usage:
//   ENGINE=chromium BASE_URL=https://thock.algoty.com node tests/desk-audio.mjs
//   ENGINE=webkit   BASE_URL=https://thock.algoty.com node tests/desk-audio.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:6803').replace(/\/$/, '');
const ENGINE = process.env.ENGINE || 'chromium';

const AUDIO_TAP_INIT = `(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (/webgl/i.test(String(type))) return null;
    return orig.call(this, type, ...rest);
  };
  if (location.origin !== 'null' && !localStorage.getItem('thock-lab:v1')) {
    localStorage.setItem('thock-lab:v1', JSON.stringify({ hintsDismissed: true }));
  }

  const probe = window.__deskClipProbe = {
    renders: 0,
    lastBuffer: null,
    buffers: [],
    peaks: [],
    overFullScale: 0,
    maxPeak: 0,
    activeSamples: 0,
    masterGain: null,
    audio: null,
    sampleRate: 0,
    rafId: 0,
    lastReadTime: 0,
    resetWindow() {
      this.maxPeak = 0;
      this.overFullScale = 0;
      this.activeSamples = 0;
      this.lastReadTime = this.audio ? this.audio.currentTime : 0;
    },
    flush() {
      if (!this.analyser || !this.audio || this.audio.state !== 'running') return;
      const now = this.audio.currentTime;
      const elapsed = now - this.lastReadTime;
      if (elapsed <= 0) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      const count = Math.min(this.buf.length, Math.ceil(elapsed * this.audio.sampleRate) + 128);
      const start = Math.max(0, this.buf.length - count);
      for (let i = start; i < this.buf.length; i++) {
        const v = Math.abs(this.buf[i]);
        if (v > this.maxPeak) this.maxPeak = v;
        if (v >= 1.0) this.overFullScale++;
        if (v > 0.01) this.activeSamples++;
      }
      this.lastReadTime = now;
    },
  };

  const render = OfflineAudioContext.prototype.startRendering;
  OfflineAudioContext.prototype.startRendering = function () {
    return render.call(this).then((buffer) => {
      if (buffer.length === 24000) {
        probe.renders++;
        probe.lastBuffer = buffer;
        probe.buffers.push(buffer);
      }
      return buffer;
    });
  };

  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const createGain = AC.prototype.createGain;
    AC.prototype.createGain = function () {
      const g = createGain.apply(this, arguments);
      if (!probe.masterGain) probe.masterGain = g;
      return g;
    };
  }

  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...args) {
    const audio = this.context;
    if (target === audio.destination && !(audio instanceof OfflineAudioContext)) {
      const analyser = audio.createAnalyser();
      analyser.fftSize = 32768;
      connect.call(this, analyser);
      probe.analyser = analyser;
      probe.buf = new Float32Array(analyser.fftSize);
      probe.audio = audio;
      probe.sampleRate = audio.sampleRate;
      probe.lastReadTime = audio.currentTime;
      const tick = () => {
        probe.flush();
        probe.rafId = requestAnimationFrame(tick);
      };
      if (!probe.rafId) probe.rafId = requestAnimationFrame(tick);
    }
    return connect.call(this, target, ...args);
  };
})();`;

async function setVolume(page, pct) {
  await page.getByTestId('settings-btn').click();
  await page.getByTestId('volume-slider').fill(String(pct / 100));
  await page.getByTestId('close-settings-btn').click();
  await page.waitForTimeout(80);
}

async function measureWindow(page, fn) {
  await page.evaluate(() => window.__deskClipProbe.resetWindow());
  await fn();
  await page.waitForTimeout(260);
  return page.evaluate(() => {
    window.__deskClipProbe.flush();
    return {
      maxPeak: window.__deskClipProbe.maxPeak,
      overFullScale: window.__deskClipProbe.overFullScale,
      activeSamples: window.__deskClipProbe.activeSamples,
      sampleRate: window.__deskClipProbe.sampleRate,
    };
  });
}

async function runLivePeakTests(page, volumePct) {
  await setVolume(page, volumePct);
  const pad = page.getByLabel('Type here');
  await pad.click();

  // 1) Isolated single strokes (letter + Space)
  const singleA = await measureWindow(page, async () => {
    await page.keyboard.down('a');
    await page.waitForTimeout(90);
    await page.keyboard.up('a');
  });
  const singleSpace = await measureWindow(page, async () => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(90);
    await page.keyboard.up('Space');
  });

  // 2) Tight Space + letter overlapping pairs (~6-7 ms gaps, 6 trials)
  const spaceLetter = await measureWindow(page, async () => {
    for (let i = 0; i < 6; i++) {
      const letter = ['a', 's', 'd', 'f', 'e', 't'][i];
      await page.keyboard.down('Space');
      await page.waitForTimeout(6);
      await page.keyboard.down(letter);
      await page.waitForTimeout(35);
      await page.keyboard.up('Space');
      await page.keyboard.up(letter);
      await page.waitForTimeout(45);
    }
  });

  // 3) Fast 3-key rolls (A-S-D with ~6-7 ms gaps, 5 trials)
  const threeKeyRoll = await measureWindow(page, async () => {
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('a');
      await page.waitForTimeout(6);
      await page.keyboard.down('s');
      await page.waitForTimeout(6);
      await page.keyboard.down('d');
      await page.waitForTimeout(35);
      await page.keyboard.up('a');
      await page.keyboard.up('s');
      await page.keyboard.up('d');
      await page.waitForTimeout(45);
    }
  });

  // 4) 10-key burst in rapid overlap (both in pad and Background)
  const tenKeyBurst = await measureWindow(page, async () => {
    const keys = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'Space'];
    for (const k of keys) {
      await page.keyboard.down(k);
      await page.waitForTimeout(5);
    }
    await page.waitForTimeout(40);
    for (const k of keys) await page.keyboard.up(k);
  });

  // 5) Background mode tight Space+A + 10-key burst
  await page.getByRole('button', { name: 'Background' }).click();
  await page.getByRole('heading', { name: 'Desk mode' }).click();
  const bgBurst = await measureWindow(page, async () => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(6);
    await page.keyboard.down('a');
    await page.waitForTimeout(6);
    await page.keyboard.down('s');
    await page.waitForTimeout(6);
    await page.keyboard.down('d');
    await page.waitForTimeout(30);
    for (const k of ['Space', 'a', 's', 'd']) await page.keyboard.up(k);
  });
  await page.getByRole('button', { name: 'Typing pad' }).click();

  const scenarios = { singleA, singleSpace, spaceLetter, threeKeyRoll, tenKeyBurst, bgBurst };
  for (const [name, res] of Object.entries(scenarios)) {
    assert(res.activeSamples > 100, `[${ENGINE} ${volumePct}% ${name}] expected audible output, got ${res.activeSamples} active samples`);
    assert(res.overFullScale === 0, `[${ENGINE} ${volumePct}% ${name}] clipped! ${res.overFullScale} samples >= 1.0 (peak=${res.maxPeak.toFixed(4)})`);
    assert(res.maxPeak <= 0.98, `[${ENGINE} ${volumePct}% ${name}] peak ${res.maxPeak.toFixed(4)} exceeds 0.98 ceiling`);
  }
  return scenarios;
}

async function runOfflineAndLoudnessTests(page) {
  const presets = [
    { name: 'Deep Thock / Walnut', sw: 'thock', base: 'wood' },
    { name: 'Clicky / Aluminum', sw: 'clicky', base: 'aluminum' },
    { name: 'Tactile / Pastel ABS', sw: 'tactile', base: 'plastic' },
    { name: 'Linear / Pastel ABS', sw: 'linear', base: 'plastic' },
    { name: 'Bubble Pop / Pastel ABS', sw: 'bubble', base: 'plastic' },
    { name: 'Retro Arcade / Pastel ABS', sw: 'arcade', base: 'plastic' },
    { name: 'Tactile / Walnut', sw: 'tactile', base: 'wood' },
    { name: 'Tactile / Acrylic', sw: 'tactile', base: 'acrylic' },
    { name: 'Tactile / Aluminum', sw: 'tactile', base: 'aluminum' },
  ];

  // Collect calibrated pre-rendered Desk buffers from the live app for every preset
  const presetSamples = [];
  for (const preset of presets) {
    const before = await page.evaluate(() => window.__deskClipProbe.renders);
    await page.getByLabel('Switch', { exact: true }).selectOption(preset.sw);
    await page.getByLabel('Base', { exact: true }).selectOption(preset.base);
    // Switching both may trigger 1 or 2 renders; wait briefly for the final combination
    await page.waitForTimeout(180);
    await page.waitForFunction((n) => window.__deskClipProbe.renders > n, before).catch(() => {});
    await page.waitForTimeout(120);

    // Measure deterministic offline sustained typing + exact 6.5 ms Space+A roll + 3-key roll + 10-key burst
    const metrics = await page.evaluate(async () => {
      const buf = window.__deskClipProbe.lastBuffer;
      if (!buf) throw new Error('missing rendered Desk buffer');
      const sr = buf.sampleRate;
      const phaseSamples = Math.floor(0.25 * sr);
      const data = buf.getChannelData(0);

      // Compute buffer down vs up energy + spectral centroid
      const down = data.slice(0, phaseSamples);
      const up = data.slice(phaseSamples, phaseSamples * 2);
      const rmsOf = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
      const peakOf = (arr) => {
        let p = 0;
        for (let i = 0; i < arr.length; i++) p = Math.max(p, Math.abs(arr[i]));
        return p;
      };

      // Build the exact same output processing graph used by ThockAudioEngine
      const CEILING_RANGE = 4.0;
      const CEILING_KNEE = 0.78;
      const CEILING_MAX = 0.95;
      const curve = new Float32Array(4097);
      const half = 2048;
      const span = CEILING_MAX - CEILING_KNEE;
      for (let i = 0; i < curve.length; i++) {
        const x = ((i - half) / half) * CEILING_RANGE;
        const ax = Math.abs(x);
        curve[i] = ax <= CEILING_KNEE ? x : Math.sign(x) * (CEILING_KNEE + span * Math.tanh((ax - CEILING_KNEE) / span));
      }

      async function renderEvents(events, volume, durationSec) {
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offline = new OfflineCtx(1, Math.ceil(sr * durationSec), sr);
        const master = offline.createGain();
        master.gain.value = volume;
        const limiter = offline.createDynamicsCompressor();
        limiter.threshold.value = -4;
        limiter.knee.value = 3;
        limiter.ratio.value = 16;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.045;
        const drive = offline.createGain();
        drive.gain.value = 1 / CEILING_RANGE;
        const ceiling = offline.createWaveShaper();
        ceiling.curve = curve;
        ceiling.oversample = 'none';
        master.connect(limiter);
        limiter.connect(drive);
        drive.connect(ceiling);
        ceiling.connect(offline.destination);

        const downTimes = [];
        const upTimes = [];
        const voiceScale = (phase, time) => {
          const hist = phase === 'down' ? downTimes : upTimes;
          while (hist.length && time - hist[0] > 0.085) hist.shift();
          const scale = 1 / Math.sqrt(1 + 0.55 * hist.length);
          hist.push(time);
          return scale;
        };

        for (const ev of events) {
          const src = offline.createBufferSource();
          const g = offline.createGain();
          src.buffer = buf;
          src.playbackRate.value = ev.rate;
          g.gain.value = ev.gain * voiceScale(ev.phase, ev.time);
          src.connect(g);
          g.connect(master);
          src.start(ev.time, ev.phase === 'down' ? 0 : 0.25, 0.25);
        }
        const out = (await offline.startRendering()).getChannelData(0);
        let peak = 0;
        let over = 0;
        let sumSq = 0;
        for (let i = 0; i < out.length; i++) {
          const a = Math.abs(out[i]);
          if (a > peak) peak = a;
          if (a >= 1.0) over++;
          sumSq += out[i] * out[i];
        }
        return { peak, over, rms: Math.sqrt(sumSq / out.length) };
      }

      // Sustained 12 keys/s typing pattern (4 seconds = 48 strokes with realistic Space + letters)
      const sustainedEvents = [];
      for (let i = 0; i < 48; i++) {
        const isSpace = i % 6 === 5;
        const t = 0.02 + i * 0.082;
        const rate = isSpace ? 0.82 : 0.985 + ((i * 17) % 35) / 1000;
        const gain = isSpace ? 1.15 : 0.97 + ((i * 13) % 50) / 1000;
        sustainedEvents.push({ phase: 'down', time: t, rate, gain });
        sustainedEvents.push({ phase: 'up', time: t + 0.055, rate, gain });
      }
      const sustained85 = await renderEvents(sustainedEvents, 0.85, 4.25);

      // Worst-case deterministic stress test: 6.5 ms Space+A, 3-key 6 ms roll, and 10-key 5 ms burst at 100%
      const stressEvents = [
        // Space + A (6.5 ms)
        { phase: 'down', time: 0.02, rate: 0.82, gain: 1.21 },
        { phase: 'down', time: 0.0265, rate: 1.01, gain: 1.06 },
        { phase: 'up', time: 0.075, rate: 0.82, gain: 1.21 },
        { phase: 'up', time: 0.0815, rate: 1.01, gain: 1.06 },
        // A-S-D 3-key roll (6 ms gaps)
        { phase: 'down', time: 0.30, rate: 1.00, gain: 1.05 },
        { phase: 'down', time: 0.306, rate: 1.02, gain: 1.05 },
        { phase: 'down', time: 0.312, rate: 0.99, gain: 1.05 },
        // 10-key simultaneous/5ms burst including Space + Enter + Backspace
        ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({
          phase: 'down',
          time: 0.60 + i * 0.005,
          rate: i === 0 ? 0.82 : i === 1 ? 0.89 : 0.98 + i * 0.004,
          gain: i === 0 ? 1.21 : i === 1 ? 1.17 : 1.06,
        })),
      ];
      const stress85 = await renderEvents(stressEvents, 0.85, 1.1);
      const stress100 = await renderEvents(stressEvents, 1.0, 1.1);

      return {
        bufDownPeak: peakOf(down),
        bufDownRms: rmsOf(down),
        bufUpRms: rmsOf(up),
        sustained85,
        stress85,
        stress100,
      };
    });

    presetSamples.push({ ...preset, ...metrics });
    assert(metrics.stress85.over === 0 && metrics.stress85.peak <= 0.98,
      `[${ENGINE} offline 85% ${preset.name}] peak=${metrics.stress85.peak.toFixed(4)} over=${metrics.stress85.over}`);
    assert(metrics.stress100.over === 0 && metrics.stress100.peak <= 0.98,
      `[${ENGINE} offline 100% ${preset.name}] peak=${metrics.stress100.peak.toFixed(4)} over=${metrics.stress100.over}`);
    assert(metrics.bufDownRms > metrics.bufUpRms,
      `[${ENGINE} ${preset.name}] downstroke must be louder than release`);
  }

  const rmsList = presetSamples.map((p) => p.sustained85.rms);
  const maxRms = Math.max(...rmsList);
  const minRms = Math.min(...rmsList);
  const spreadDb = 20 * Math.log10(maxRms / minRms);
  assert(spreadDb <= 2.3, `[${ENGINE}] preset RMS spread too wide: ${spreadDb.toFixed(2)} dB (max=${maxRms.toFixed(4)}, min=${minRms.toFixed(4)})`);

  return { presetSamples, spreadDb, maxRms, minRms };
}

console.log(`Desk Audio Verification · ${ENGINE} · ${BASE_URL}`);
const browser = ENGINE === 'webkit'
  ? await pw.webkit.launch()
  : await pw.chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2'] });

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(AUDIO_TAP_INIT);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.getByTestId('mode-desk-btn').click();
  await page.waitForFunction(() => window.__deskClipProbe.renders >= 1);

  const live85 = await runLivePeakTests(page, 85);
  const live100 = await runLivePeakTests(page, 100);
  const { presetSamples, spreadDb } = await runOfflineAndLoudnessTests(page);

  const livePeaks85 = Object.values(live85).map((r) => r.maxPeak);
  const livePeaks100 = Object.values(live100).map((r) => r.maxPeak);
  const offlinePeaks85 = presetSamples.map((p) => p.stress85.peak);
  const offlinePeaks100 = presetSamples.map((p) => p.stress100.peak);
  const overallMax = Math.max(...livePeaks85, ...livePeaks100, ...offlinePeaks85, ...offlinePeaks100);

  console.log(`  Live 85%  (${ENGINE}): singleA=${live85.singleA.maxPeak.toFixed(3)}, singleSpace=${live85.singleSpace.maxPeak.toFixed(3)}, space+letter=${live85.spaceLetter.maxPeak.toFixed(3)}, 3-roll=${live85.threeKeyRoll.maxPeak.toFixed(3)}, 10-burst=${live85.tenKeyBurst.maxPeak.toFixed(3)}, bg=${live85.bgBurst.maxPeak.toFixed(3)}`);
  console.log(`  Live 100% (${ENGINE}): singleA=${live100.singleA.maxPeak.toFixed(3)}, singleSpace=${live100.singleSpace.maxPeak.toFixed(3)}, space+letter=${live100.spaceLetter.maxPeak.toFixed(3)}, 3-roll=${live100.threeKeyRoll.maxPeak.toFixed(3)}, 10-burst=${live100.tenKeyBurst.maxPeak.toFixed(3)}, bg=${live100.bgBurst.maxPeak.toFixed(3)}`);
  console.log(`  Offline stress (${ENGINE}): max85=${Math.max(...offlinePeaks85).toFixed(4)}, max100=${Math.max(...offlinePeaks100).toFixed(4)}, overallMax=${overallMax.toFixed(4)}`);
  console.log(`  Preset loudness spread (${ENGINE}): ${spreadDb.toFixed(2)} dB across 9 presets:`);
  for (const p of presetSamples) {
    console.log(`    ${p.name.padEnd(26)} sustainedRMS=${p.sustained85.rms.toFixed(4)}  stress85=${p.stress85.peak.toFixed(3)}  stress100=${p.stress100.peak.toFixed(3)}`);
  }
  console.log(`DESK AUDIO PASS (${ENGINE} · max peak ${overallMax.toFixed(4)} · spread ${spreadDb.toFixed(2)} dB · 0 samples >= 1.0)`);
  await ctx.close();
} finally {
  await browser.close();
}
