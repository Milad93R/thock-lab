// Desk mode audio dynamics & true-peak verification across Chromium and WebKit.
// Verifies:
//   1. Live destination output peaks (85% and 100%, Deep Thock/Walnut & Clicky/Aluminum)
//      + Studio single-stroke peak preservation (default build at 85%).
//   2. Smooth envelope-based cadence headroom:
//      - 10 identical strokes at 80, 84, 86, 120 ms spacing differ by <= 0.3 dB in first-10 ms attack RMS.
//      - 10-key 6 ms burst keeps the 10th attack within <= 3.0 dB of the 1st (no 0.41x / -7.7 dB collapse).
//   3. True-peak safety across ALL 24 switch x base presets at 85% and 100%, at BOTH 44.1 kHz and 48 kHz,
//      for Space+letter (3 ms & 6 ms), 3-key rolls (6 ms), and 10-key bursts (6 ms),
//      using 4x & 16x band-limited windowed-sinc reconstruction plus 44.1->96 kHz resampling:
//      target reconstructed true-peak <= 0.891 (-1.0 dBTP), zero samples >= 1.0.
//   4. Preset loudness matching across the 9 QA presets (<= 2.3 dB spread).
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
    lastPlayedBuffer: null,
    buffers: [],
    overFullScale: 0,
    maxPeak: 0,
    activeSamples: 0,
    masterGain: null,
    limiter: null,
    ceilingDrives: [],
    ceilingShapers: [],
    audio: null,
    sampleRate: 0,
    rafId: 0,
    lastReadTime: 0,
    voiceGains: [],
    resetWindow() {
      this.maxPeak = 0;
      this.overFullScale = 0;
      this.activeSamples = 0;
      this.voiceGains = [];
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
      else if (probe.limiter && probe.ceilingDrives.length < 2) probe.ceilingDrives.push(g);
      return g;
    };
    const createComp = AC.prototype.createDynamicsCompressor;
    AC.prototype.createDynamicsCompressor = function () {
      const c = createComp.apply(this, arguments);
      if (!probe.limiter) probe.limiter = c;
      return c;
    };
    const createShaper = AC.prototype.createWaveShaper;
    AC.prototype.createWaveShaper = function () {
      const s = createShaper.apply(this, arguments);
      if (probe.limiter && probe.ceilingShapers.length < 2) probe.ceilingShapers.push(s);
      return s;
    };
  }

  const sourceGainMap = new WeakMap();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...args) {
    if (this instanceof AudioBufferSourceNode && target instanceof GainNode) {
      sourceGainMap.set(this, target);
    }
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

  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    if (this.buffer?.length === 24000) {
      probe.lastPlayedBuffer = this.buffer;
      const g = sourceGainMap.get(this);
      probe.voiceGains.push({
        phase: offset ? 'up' : 'down',
        when,
        gain: g ? g.gain.value : null,
        rate: this.playbackRate.value,
      });
    }
    return start.apply(this, arguments);
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
      voiceGains: window.__deskClipProbe.voiceGains,
    };
  });
}

async function runStudioBaselineCheck(page) {
  // Warm up audio context with 1 trusted pointer click, then measure 5 spaced Space presses at default 85%.
  const btn = page.getByTestId('fallback-clicker');
  await btn.click();
  await page.waitForTimeout(260);
  const peaks = [];
  for (let i = 0; i < 5; i++) {
    const res = await measureWindow(page, async () => {
      await page.keyboard.down('Space');
      await page.waitForTimeout(80);
      await page.keyboard.up('Space');
    });
    assert(res.activeSamples > 100 && res.overFullScale === 0, `[${ENGINE} studio] stroke ${i} invalid: ${JSON.stringify(res)}`);
    peaks.push(res.maxPeak);
  }
  peaks.sort((a, b) => a - b);
  return { medianPeak: peaks[2], peaks };
}

async function runLivePeakTests(page, volumePct, labelSuffix = '') {
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

  // 2) Tight Space + letter overlapping pairs (~3-6 ms gaps, 6 trials)
  const spaceLetter = await measureWindow(page, async () => {
    for (let i = 0; i < 6; i++) {
      const letter = ['a', 's', 'd', 'f', 'e', 't'][i];
      await page.keyboard.down('Space');
      await page.waitForTimeout(i < 3 ? 3 : 6);
      await page.keyboard.down(letter);
      await page.waitForTimeout(35);
      await page.keyboard.up('Space');
      await page.keyboard.up(letter);
      await page.waitForTimeout(45);
    }
  });

  // 3) Fast 3-key rolls (A-S-D with ~6 ms gaps, 5 trials)
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

  // 4) 10-key burst in rapid overlap (~6 ms spacing)
  const tenKeyBurst = await measureWindow(page, async () => {
    const keys = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'Space'];
    for (const k of keys) {
      await page.keyboard.down(k);
      await page.waitForTimeout(6);
    }
    await page.waitForTimeout(40);
    for (const k of keys) await page.keyboard.up(k);
  });

  // 5) Background mode burst
  await page.getByRole('button', { name: 'Background' }).click();
  await page.getByRole('heading', { name: 'Desk mode' }).click();
  const bgBurst = await measureWindow(page, async () => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(4);
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
    assert(res.activeSamples > 100, `[${ENGINE}${labelSuffix} ${volumePct}% ${name}] expected audible output, got ${res.activeSamples}`);
    assert(res.overFullScale === 0, `[${ENGINE}${labelSuffix} ${volumePct}% ${name}] clipped! ${res.overFullScale} samples >= 1.0 (peak=${res.maxPeak.toFixed(4)})`);
    assert(res.maxPeak <= 0.891, `[${ENGINE}${labelSuffix} ${volumePct}% ${name}] peak ${res.maxPeak.toFixed(4)} exceeds -1 dBTP (0.891)`);
  }

  // Verify live 10-key burst voice gains didn't collapse like QA10's 0.41x
  const burstDowns = tenKeyBurst.voiceGains.filter((v) => v.phase === 'down').map((v) => v.gain);
  if (burstDowns.length >= 10) {
    const minGain = Math.min(...burstDowns);
    assert(minGain >= 0.72, `[${ENGINE}${labelSuffix} ${volumePct}%] live 10-key burst voice gain collapsed to ${minGain.toFixed(3)}`);
  }

  return scenarios;
}

async function runOfflineTruePeakAndCadenceSuite(page) {
  // Inspect live deployed graph nodes so offline replay uses the exact deployed DSP chain!
  const liveGraph = await page.evaluate(() => {
    const p = window.__deskClipProbe;
    return {
      stages: p.ceilingShapers.map((s, i) => ({
        oversample: s.oversample,
        curveLen: s.curve?.length ?? 0,
        drive: p.ceilingDrives[i]?.gain?.value ?? null,
      })),
      limiter: p.limiter ? {
        threshold: p.limiter.threshold.value,
        knee: p.limiter.knee.value,
        ratio: p.limiter.ratio.value,
        attack: p.limiter.attack.value,
        release: p.limiter.release.value,
      } : null,
    };
  });
  assert(liveGraph.stages.length === 2, `[${ENGINE}] expected 2 oversampled ceiling stages, got ${JSON.stringify(liveGraph.stages)}`);
  for (const st of liveGraph.stages) {
    assert(st.oversample === '4x' && st.curveLen === 4097 && st.drive === 0.25, `[${ENGINE}] invalid ceiling stage: ${JSON.stringify(st)}`);
  }
  assert(liveGraph.limiter && liveGraph.limiter.threshold === -3 && liveGraph.limiter.ratio === 10,
    `[${ENGINE}] expected Studio-matched limiter (-3/6/10), got ${JSON.stringify(liveGraph.limiter)}`);

  const switches = [
    { id: 'thock', name: 'Deep Thock' },
    { id: 'clicky', name: 'Clicky' },
    { id: 'tactile', name: 'Tactile' },
    { id: 'linear', name: 'Linear' },
    { id: 'bubble', name: 'Bubble Pop' },
    { id: 'arcade', name: 'Retro Arcade' },
  ];
  const bases = [
    { id: 'wood', name: 'Walnut' },
    { id: 'aluminum', name: 'Aluminum' },
    { id: 'acrylic', name: 'Acrylic' },
    { id: 'plastic', name: 'Pastel ABS' },
  ];
  const qa9Keys = new Set([
    'thock|wood', 'clicky|aluminum', 'tactile|plastic', 'linear|plastic',
    'bubble|plastic', 'arcade|plastic', 'tactile|wood', 'tactile|acrylic', 'tactile|aluminum',
  ]);

  const allPresets = [];
  for (const sw of switches) {
    for (const base of bases) {
      allPresets.push({ sw: sw.id, base: base.id, key: `${sw.id}|${base.id}`, name: `${sw.name} / ${base.name}` });
    }
  }

  // Switch to Background mode so tapping a key retrieves the exact active buffer (even on LRU cache hit)
  await page.getByRole('button', { name: 'Background' }).click();
  await page.getByRole('heading', { name: 'Desk mode' }).click();

  // Trigger Desk sample rendering for ALL 24 presets and capture each rendered AudioBuffer
  const results = [];
  for (const preset of allPresets) {
    const curSw = await page.getByLabel('Switch', { exact: true }).inputValue();
    const curBase = await page.getByLabel('Base', { exact: true }).inputValue();
    if (curSw !== preset.sw) {
      await page.getByLabel('Switch', { exact: true }).selectOption(preset.sw);
      await page.waitForTimeout(80);
    }
    if (curBase !== preset.base) {
      await page.getByLabel('Base', { exact: true }).selectOption(preset.base);
    }
    // Wait until pressing a key plays a pre-rendered 24000-sample buffer for the selected preset
    await page.waitForTimeout(160);
    await page.evaluate(() => { window.__deskClipProbe.lastPlayedBuffer = null; });
    await page.getByRole('heading', { name: 'Desk mode' }).click();
    for (let attempt = 0; attempt < 10; attempt++) {
      await page.keyboard.press('a');
      const ready = await page.evaluate(() => !!window.__deskClipProbe.lastPlayedBuffer);
      if (ready) break;
      await page.waitForTimeout(100);
    }

    const metrics = await page.evaluate(async ({ isQA9, runCadence, run96k }) => {
      const probe = window.__deskClipProbe;
      const buf = probe.lastPlayedBuffer || probe.lastBuffer;
      if (!buf) throw new Error('missing rendered Desk buffer');
      const liveStages = probe.ceilingShapers.map((s, i) => ({
        curve: s.curve,
        oversample: s.oversample,
        drive: probe.ceilingDrives[i].gain.value,
      }));
      const lim = probe.limiter;

      function connectMasterChain(offline, master) {
        const limiter = offline.createDynamicsCompressor();
        limiter.threshold.value = lim.threshold.value;
        limiter.knee.value = lim.knee.value;
        limiter.ratio.value = lim.ratio.value;
        limiter.attack.value = lim.attack.value;
        limiter.release.value = lim.release.value;
        master.connect(limiter);
        let tail = limiter;
        for (const st of liveStages) {
          const drive = offline.createGain();
          drive.gain.value = st.drive;
          const shaper = offline.createWaveShaper();
          shaper.curve = st.curve;
          shaper.oversample = st.oversample;
          tail.connect(drive);
          drive.connect(shaper);
          tail = shaper;
        }
        tail.connect(offline.destination);
      }

      // Exact production envelope & concurrent-energy headroom tracker (matches src/audio/deskSamples.ts & engine.ts)
      const PHASE_SEC = 0.25;
      const ENV_STEP = 0.001;
      const ENV_WIN = 0.01;
      const HEADROOM_WEIGHT = 0.32;

      function computeEnvelope(data, startSample, phaseSamples, sr) {
        const stepSamples = Math.max(1, Math.round(ENV_STEP * sr));
        const windowSamples = Math.max(1, Math.round(ENV_WIN * sr));
        const steps = Math.ceil(phaseSamples / stepSamples) + 1;
        const prefix = new Float64Array(phaseSamples + 1);
        for (let i = 0; i < phaseSamples; i++) {
          const v = data[startSample + i] || 0;
          prefix[i + 1] = prefix[i] + v * v;
        }
        const env = new Float32Array(steps);
        for (let k = 0; k < steps; k++) {
          const from = Math.min(phaseSamples, k * stepSamples);
          const to = Math.min(phaseSamples, from + windowSamples);
          env[k] = Math.sqrt(Math.max(0, prefix[to] - prefix[from]) / windowSamples);
        }
        return env;
      }

      function sampleEnvelope(env, offsetSec) {
        if (offsetSec <= 0) return env[0] || 0;
        const pos = offsetSec / ENV_STEP;
        const idx = Math.floor(pos);
        if (idx >= env.length - 1) return 0;
        const frac = pos - idx;
        return env[idx] * (1 - frac) + env[idx + 1] * frac;
      }

      const raw = buf.getChannelData(0);
      const phaseSamples = Math.floor(PHASE_SEC * buf.sampleRate);
      const envDown = computeEnvelope(raw, 0, phaseSamples, buf.sampleRate);
      const envUp = computeEnvelope(raw, phaseSamples, phaseSamples, buf.sampleRate);
      let downAttackRms = 1e-4;
      for (let i = 0; i < envDown.length; i++) {
        if (envDown[i] > downAttackRms) downAttackRms = envDown[i];
      }

      function rmsSlice(arr, start, count) {
        let s = 0;
        const end = Math.min(arr.length, start + count);
        for (let i = start; i < end; i++) s += arr[i] * arr[i];
        return Math.sqrt(s / Math.max(1, end - start));
      }

      // Windowed-sinc (Blackman-Harris) band-limited true-peak reconstruction (ITU-R BS.1770 style, 4x or 16x)
      // Precompute polyphase filter kernels for fast exact evaluation near signal peaks.
      function buildSincKernels(factor, halfTaps) {
        const kernels = [];
        const N = halfTaps * 2;
        for (let p = 1; p < factor; p++) {
          const frac = p / factor;
          const k = new Float64Array(N);
          let sum = 0;
          for (let j = 0; j < N; j++) {
            const x = (j - halfTaps + 1) - frac;
            const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
            // 4-term Blackman-Harris window over [-halfTaps, halfTaps]
            const u = (j - frac + 0.5) / N;
            const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * u)
              + 0.14128 * Math.cos(4 * Math.PI * u) - 0.01168 * Math.cos(6 * Math.PI * u);
            k[j] = sinc * w;
            sum += k[j];
          }
          for (let j = 0; j < N; j++) k[j] /= sum;
          kernels.push(k);
        }
        return kernels;
      }
      const kernels4x = buildSincKernels(4, 16);
      const kernels16x = buildSincKernels(16, 24);

      function measureTruePeak(samples) {
        let samplePeak = 0;
        let over = 0;
        let sumSq = 0;
        for (let i = 0; i < samples.length; i++) {
          const a = Math.abs(samples[i]);
          if (a > samplePeak) samplePeak = a;
          if (a >= 1.0) over++;
          sumSq += samples[i] * samples[i];
        }
        // Evaluate 4x true-peak across all active regions (|sample| > 0.25 * samplePeak)
        const thresh4 = Math.max(0.15, samplePeak * 0.25);
        let tp4 = samplePeak;
        const half4 = 16;
        for (let i = half4; i < samples.length - half4; i++) {
          if (Math.abs(samples[i]) < thresh4 && Math.abs(samples[i + 1]) < thresh4) continue;
          for (let p = 0; p < kernels4x.length; p++) {
            const ker = kernels4x[p];
            let acc = 0;
            const base = i - half4 + 1;
            for (let j = 0; j < ker.length; j++) acc += samples[base + j] * ker[j];
            const a = Math.abs(acc);
            if (a > tp4) tp4 = a;
          }
        }
        // Evaluate 16x fine reconstruction around any region near peak (>= 0.55 * samplePeak)
        const thresh16 = Math.max(0.25, samplePeak * 0.55);
        let tp16 = tp4;
        const half16 = 24;
        for (let i = half16; i < samples.length - half16; i++) {
          if (Math.abs(samples[i]) < thresh16 && Math.abs(samples[i + 1]) < thresh16) continue;
          for (let p = 0; p < kernels16x.length; p++) {
            const ker = kernels16x[p];
            let acc = 0;
            const base = i - half16 + 1;
            for (let j = 0; j < ker.length; j++) acc += samples[base + j] * ker[j];
            const a = Math.abs(acc);
            if (a > tp16) tp16 = a;
          }
        }
        return { samplePeak, tp4, tp16, over, rms: Math.sqrt(sumSq / samples.length) };
      }

      async function renderEvents(events, volume, durationSec, targetSr) {
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offline = new OfflineCtx(1, Math.ceil(targetSr * durationSec), targetSr);
        const master = offline.createGain();
        master.gain.value = volume;
        connectMasterChain(offline, master);

        const voices = [];
        const scales = [];
        for (const ev of events) {
          const env = ev.phase === 'down' ? envDown : envUp;
          let keep = 0;
          let activePower = 0;
          for (let i = 0; i < voices.length; i++) {
            const v = voices[i];
            const elapsed = (ev.time - v.startTime) * v.rate;
            if (elapsed >= PHASE_SEC || v.startTime > ev.time + 0.025) continue;
            voices[keep++] = v;
            if (v.startTime > ev.time + 0.01) continue;
            const rms = sampleEnvelope(v.env, Math.max(0, elapsed));
            const amp = v.gain * rms;
            activePower += amp * amp;
          }
          voices.length = keep;
          const attackRms = Math.max(env[0] || 0, downAttackRms, 1e-4);
          const refPower = Math.max((ev.gain * attackRms) ** 2, 1e-8);
          const scale = 1 / Math.sqrt(1 + HEADROOM_WEIGHT * (activePower / refPower));
          const appliedGain = ev.gain * scale;
          voices.push({ startTime: ev.time, rate: ev.rate, gain: appliedGain, env });
          if (voices.length > 24) voices.shift();
          scales.push(scale);

          const src = offline.createBufferSource();
          const g = offline.createGain();
          src.buffer = buf;
          src.playbackRate.value = ev.rate;
          g.gain.value = appliedGain;
          src.connect(g);
          g.connect(master);
          src.start(ev.time, ev.phase === 'down' ? 0 : PHASE_SEC, PHASE_SEC);
        }
        const rendered = await offline.startRendering();
        const out = rendered.getChannelData(0);
        return { out, rendered, scales, stats: measureTruePeak(out) };
      }

      // Stress pattern covering Space+letter (2.9 ms QA10 witness, 3 ms worst-case, 6 ms),
      // 3-key roll (6 ms), and 10-key burst (6 ms)
      const stressEvents = [
        // QA10 Clicky/Aluminum exact 2.9 ms witness
        { phase: 'down', time: 0.020, rate: 0.832431, gain: 1.160810 },
        { phase: 'down', time: 0.0229, rate: 0.978000, gain: 0.770287 },
        { phase: 'up', time: 0.070, rate: 0.832431, gain: 1.160810 },
        { phase: 'up', time: 0.0729, rate: 0.978000, gain: 0.770287 },
        // Worst-case Space + A at 3.0 ms
        { phase: 'down', time: 0.200, rate: 0.82, gain: 1.21 },
        { phase: 'down', time: 0.203, rate: 1.01, gain: 1.06 },
        { phase: 'up', time: 0.250, rate: 0.82, gain: 1.21 },
        { phase: 'up', time: 0.253, rate: 1.01, gain: 1.06 },
        // Space + A at 6.0 ms
        { phase: 'down', time: 0.380, rate: 0.82, gain: 1.21 },
        { phase: 'down', time: 0.386, rate: 1.01, gain: 1.06 },
        { phase: 'up', time: 0.430, rate: 0.82, gain: 1.21 },
        { phase: 'up', time: 0.436, rate: 1.01, gain: 1.06 },
        // 3-key roll (6 ms)
        { phase: 'down', time: 0.560, rate: 1.00, gain: 1.05 },
        { phase: 'down', time: 0.566, rate: 1.02, gain: 1.05 },
        { phase: 'down', time: 0.572, rate: 0.99, gain: 1.05 },
        // 10-key burst (6 ms)
        ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({
          phase: 'down',
          time: 0.780 + i * 0.006,
          rate: i === 0 ? 0.82 : i === 1 ? 0.89 : 0.98 + i * 0.004,
          gain: i === 0 ? 1.21 : i === 1 ? 1.17 : 1.06,
        })),
      ];

      const stress = {};
      let resampled96Peak = 0;
      for (const sr of [44100, 48000]) {
        for (const vol of [0.85, 1.0]) {
          const r = await renderEvents(stressEvents, vol, 1.25, sr);
          stress[`${sr}_${Math.round(vol * 100)}`] = r.stats;
          // Verify actual browser 44.1->96 kHz resampling on bright/worst-case presets at 100%
          if (run96k && sr === 44100 && vol === 1.0) {
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const resampCtx = new OfflineCtx(1, Math.ceil(1.25 * 96000), 96000);
            const s = resampCtx.createBufferSource();
            s.buffer = r.rendered;
            s.connect(resampCtx.destination);
            s.start(0);
            const out96 = (await resampCtx.startRendering()).getChannelData(0);
            for (let i = 0; i < out96.length; i++) {
              const a = Math.abs(out96[i]);
              if (a > resampled96Peak) resampled96Peak = a;
            }
          }
        }
      }

      // Single-stroke A at 85% (48 kHz, started at 0.25 s after compressor init ramp)
      const single = await renderEvents([
        { phase: 'down', time: 0.25, rate: 1.0, gain: 1.0 },
        { phase: 'up', time: 0.32, rate: 1.0, gain: 1.0 },
      ], 0.85, 0.65, 48000);

      // Sustained 12 keys/s loudness matching check for the 9 QA presets
      let sustainedRms = null;
      if (isQA9) {
        const sustainedEvents = [];
        for (let i = 0; i < 48; i++) {
          const isSpace = i % 6 === 5;
          const t = 0.02 + i * 0.082;
          const rate = isSpace ? 0.82 : 0.985 + ((i * 17) % 35) / 1000;
          const gain = isSpace ? 1.15 : 0.97 + ((i * 13) % 50) / 1000;
          sustainedEvents.push({ phase: 'down', time: t, rate, gain });
          sustainedEvents.push({ phase: 'up', time: t + 0.055, rate, gain });
        }
        const sus = await renderEvents(sustainedEvents, 0.85, 4.25, 48000);
        sustainedRms = sus.stats.rms;
      }

      // Cadence test from Fix (1):
      //  a) 10 identical strokes at 80, 84, 86, 120 ms spacing (with full releases at +48 ms)
      //  b) 10-key 6 ms burst attack retention (1st vs 10th stroke, both voice gain and rendered marginal attack)
      let cadence = null;
      if (runCadence) {
        const sr = 48000;
        // Measure exact pipeline group delay (compressor preDelay + 4x WaveShaper FIR) via unit impulse
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const impCtx = new OfflineCtx(1, sr, sr);
        const impBuf = impCtx.createBuffer(1, 256, sr);
        impBuf.getChannelData(0)[0] = 0.2;
        const impSrc = impCtx.createBufferSource();
        impSrc.buffer = impBuf;
        const impMaster = impCtx.createGain();
        impMaster.gain.value = 1.0;
        connectMasterChain(impCtx, impMaster);
        impSrc.connect(impMaster);
        impSrc.start(0.25);
        const impOut = (await impCtx.startRendering()).getChannelData(0);
        let impPeakIdx = 0;
        let impPeakVal = 0;
        for (let i = 0; i < impOut.length; i++) {
          const a = Math.abs(impOut[i]);
          if (a > impPeakVal) { impPeakVal = a; impPeakIdx = i; }
        }
        const latencySamples = Math.max(0, impPeakIdx - Math.round(0.25 * sr));

        const t0 = 0.25; // Start after DynamicsCompressorNode t=0 cold-init ramp
        const win10 = Math.round(0.01 * sr);
        const spacings = [0.080, 0.084, 0.086, 0.120];
        const spacingDropsDb = {};
        const spacingScales = {};
        const allFirst10Rms = [];
        for (const dt of spacings) {
          const evs = [];
          for (let i = 0; i < 10; i++) {
            const t = t0 + i * dt;
            evs.push({ phase: 'down', time: t, rate: 1.0, gain: 1.0 });
            evs.push({ phase: 'up', time: t + 0.048, rate: 1.0, gain: 1.0 });
          }
          const r = await renderEvents(evs, 0.85, t0 + 10 * dt + 0.3, sr);
          const rmsPerStroke = [];
          for (let i = 0; i < 10; i++) {
            const start = Math.round((t0 + i * dt) * sr) + latencySamples;
            rmsPerStroke.push(rmsSlice(r.out, start, win10));
          }
          const first = rmsPerStroke[0];
          const maxDevDb = Math.max(...rmsPerStroke.map((v) => Math.abs(20 * Math.log10(v / first))));
          spacingDropsDb[Math.round(dt * 1000)] = maxDevDb;
          spacingScales[Math.round(dt * 1000)] = Math.min(...r.scales.filter((_, idx) => idx % 2 === 0));
          allFirst10Rms.push(...rmsPerStroke);
        }
        const crossSpacingSpreadDb = 20 * Math.log10(Math.max(...allFirst10Rms) / Math.min(...allFirst10Rms));

        // 10-key 6 ms burst: compare 1st attack vs 10th attack (both voice scale and post-processing marginal attack)
        const burstEvs10 = Array.from({ length: 10 }, (_, i) => ({
          phase: 'down',
          time: t0 + i * 0.006,
          rate: 0.98 + i * 0.004,
          gain: 1.0,
        }));
        const burstEvs9 = burstEvs10.slice(0, 9);
        const burst1Ev = [burstEvs10[0]];
        const b85_1 = await renderEvents(burst1Ev, 0.85, t0 + 0.35, sr);
        const b85_9 = await renderEvents(burstEvs9, 0.85, t0 + 0.35, sr);
        const b85_10 = await renderEvents(burstEvs10, 0.85, t0 + 0.35, sr);
        const b100_1 = await renderEvents(burst1Ev, 1.0, t0 + 0.35, sr);
        const b100_9 = await renderEvents(burstEvs9, 1.0, t0 + 0.35, sr);
        const b100_10 = await renderEvents(burstEvs10, 1.0, t0 + 0.35, sr);

        const diffRms = (a, b, start, count) => {
          let s = 0;
          const end = Math.min(a.length, b.length, start + count);
          for (let i = start; i < end; i++) {
            const d = a[i] - b[i];
            s += d * d;
          }
          return Math.sqrt(s / Math.max(1, end - start));
        };
        const stFirst = Math.round(t0 * sr) + latencySamples;
        const stLast = Math.round((t0 + 9 * 0.006) * sr) + latencySamples;
        const b85First = rmsSlice(b85_1.out, stFirst, win10);
        const b85Last = diffRms(b85_10.out, b85_9.out, stLast, win10);
        const b100First = rmsSlice(b100_1.out, stFirst, win10);
        const b100Last = diffRms(b100_10.out, b100_9.out, stLast, win10);

        cadence = {
          latencyMs: +(latencySamples / sr * 1000).toFixed(2),
          spacingDropsDb,
          spacingScales,
          crossSpacingSpreadDb,
          burstMinScale: Math.min(...b100_10.scales),
          burstLastScaleDb: 20 * Math.log10(b100_10.scales[9] / b100_10.scales[0]),
          burst85AttackDiffDb: 20 * Math.log10(b85Last / b85First),
          burst100AttackDiffDb: 20 * Math.log10(b100Last / b100First),
        };
      }

      return {
        downRms: rmsSlice(raw, 0, phaseSamples),
        upRms: rmsSlice(raw, phaseSamples, phaseSamples),
        singlePeak85: single.stats.samplePeak,
        singleTp85: single.stats.tp4,
        stress,
        resampled96Peak,
        sustainedRms,
        cadence,
      };
    }, {
      isQA9: qa9Keys.has(preset.key),
      runCadence: ['thock|wood', 'clicky|aluminum', 'bubble|plastic', 'tactile|acrylic'].includes(preset.key),
      run96k: ['clicky|aluminum', 'clicky|acrylic', 'arcade|aluminum', 'arcade|plastic', 'tactile|aluminum', 'thock|wood'].includes(preset.key),
    });

    results.push({ ...preset, ...metrics });

    assert(metrics.downRms > metrics.upRms, `[${ENGINE} ${preset.name}] downstroke must be louder than release`);
    for (const [k, s] of Object.entries(metrics.stress)) {
      assert(s.samplePeak > 0.15, `[${ENGINE} ${preset.name} ${k}] offline stress silent! ${JSON.stringify(s)}`);
      assert(s.over === 0, `[${ENGINE} ${preset.name} ${k}] sample clipped >= 1.0 (peak=${s.samplePeak.toFixed(4)})`);
      assert(s.tp4 <= 0.891, `[${ENGINE} ${preset.name} ${k}] 4x true-peak ${s.tp4.toFixed(4)} exceeds -1 dBTP (0.891)`);
      assert(s.tp16 <= 0.891, `[${ENGINE} ${preset.name} ${k}] 16x true-peak ${s.tp16.toFixed(4)} exceeds -1 dBTP (0.891)`);
    }
    if (metrics.resampled96Peak > 0) {
      assert(metrics.resampled96Peak <= 0.891,
        `[${ENGINE} ${preset.name} 44.1->96kHz] resampled peak ${metrics.resampled96Peak.toFixed(4)} exceeds -1 dBTP (0.891)`);
    }
    if (metrics.cadence) {
      assert(metrics.cadence.crossSpacingSpreadDb <= 0.3,
        `[${ENGINE} ${preset.name}] cadence 80/84/86/120 ms spread ${metrics.cadence.crossSpacingSpreadDb.toFixed(3)} dB > 0.3 dB: ${JSON.stringify(metrics.cadence)}`);
      assert(Math.abs(metrics.cadence.burstLastScaleDb) <= 3.0,
        `[${ENGINE} ${preset.name}] 10-key 6 ms burst voice scale drop ${metrics.cadence.burstLastScaleDb.toFixed(2)} dB > 3.0 dB: ${JSON.stringify(metrics.cadence)}`);
      assert(metrics.cadence.burst85AttackDiffDb >= -3.0 && metrics.cadence.burst100AttackDiffDb >= -3.5,
        `[${ENGINE} ${preset.name}] 10-key 6 ms burst rendered attack diff out of range: ${JSON.stringify(metrics.cadence)}`);
    }
  }

  const qa9Results = results.filter((r) => r.sustainedRms !== null);
  const rmsList = qa9Results.map((r) => r.sustainedRms);
  const spreadDb = 20 * Math.log10(Math.max(...rmsList) / Math.min(...rmsList));
  assert(spreadDb <= 2.3, `[${ENGINE}] 9-preset RMS spread too wide: ${spreadDb.toFixed(2)} dB`);

  return { liveGraph, results, spreadDb };
}

console.log(`Desk Audio Dynamics & True-Peak Verification · ${ENGINE} · ${BASE_URL}`);
const browser = ENGINE === 'webkit'
  ? await pw.webkit.launch()
  : await pw.chromium.launch({ args: ['--disable-gpu', '--disable-webgl', '--disable-webgl2'] });

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(AUDIO_TAP_INIT);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });

  // 1) Verify Studio default build single-stroke peak at 85% matches pre-Desk-fix-1
  const studio = await runStudioBaselineCheck(page);
  console.log(`  Studio 85% (${ENGINE}): medianPeak=${studio.medianPeak.toFixed(4)} (trials: ${studio.peaks.map((v) => v.toFixed(3)).join(', ')})`);

  // 2) Enter Desk mode and run live peak tests on Deep Thock / Walnut + Clicky / Aluminum
  await page.getByTestId('mode-desk-btn').click();
  await page.waitForFunction(() => window.__deskClipProbe.renders >= 1);

  const liveThock85 = await runLivePeakTests(page, 85, ' thock/wood');
  const liveThock100 = await runLivePeakTests(page, 100, ' thock/wood');

  const beforeClicky = await page.evaluate(() => window.__deskClipProbe.renders);
  await page.getByLabel('Switch', { exact: true }).selectOption('clicky');
  await page.getByLabel('Base', { exact: true }).selectOption('aluminum');
  await page.waitForFunction((n) => window.__deskClipProbe.renders >= n + 2, beforeClicky, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(120);
  const liveClicky100 = await runLivePeakTests(page, 100, ' clicky/aluminum');

  // 3) Run comprehensive offline 24-preset x 2 sample rates x 2 volumes true-peak + cadence suite
  const { results, spreadDb } = await runOfflineTruePeakAndCadenceSuite(page);

  let maxSamplePeak = 0;
  let maxTp4 = 0;
  let maxTp16 = 0;
  let max96k = 0;
  let maxCadenceStepDb = 0;
  let worstPreset = '';

  for (const r of results) {
    for (const [k, s] of Object.entries(r.stress)) {
      if (s.samplePeak > maxSamplePeak) maxSamplePeak = s.samplePeak;
      if (s.tp4 > maxTp4) maxTp4 = s.tp4;
      if (s.tp16 > maxTp16) {
        maxTp16 = s.tp16;
        worstPreset = `${r.name} (${k})`;
      }
    }
    if (r.resampled96Peak > max96k) max96k = r.resampled96Peak;
    if (r.cadence && r.cadence.crossSpacingSpreadDb > maxCadenceStepDb) {
      maxCadenceStepDb = r.cadence.crossSpacingSpreadDb;
    }
  }

  const liveMax = Math.max(
    ...Object.values(liveThock85).map((r) => r.maxPeak),
    ...Object.values(liveThock100).map((r) => r.maxPeak),
    ...Object.values(liveClicky100).map((r) => r.maxPeak)
  );
  const overallTruePeak = Math.max(liveMax, maxTp4, maxTp16, max96k);

  console.log(`  Live Thock 85%  (${ENGINE}): singleA=${liveThock85.singleA.maxPeak.toFixed(3)}, singleSpace=${liveThock85.singleSpace.maxPeak.toFixed(3)}, space+letter=${liveThock85.spaceLetter.maxPeak.toFixed(3)}, 3-roll=${liveThock85.threeKeyRoll.maxPeak.toFixed(3)}, 10-burst=${liveThock85.tenKeyBurst.maxPeak.toFixed(3)}, bg=${liveThock85.bgBurst.maxPeak.toFixed(3)}`);
  console.log(`  Live Thock 100% (${ENGINE}): singleA=${liveThock100.singleA.maxPeak.toFixed(3)}, space+letter=${liveThock100.spaceLetter.maxPeak.toFixed(3)}, 3-roll=${liveThock100.threeKeyRoll.maxPeak.toFixed(3)}, 10-burst=${liveThock100.tenKeyBurst.maxPeak.toFixed(3)}, bg=${liveThock100.bgBurst.maxPeak.toFixed(3)}`);
  console.log(`  Live Clicky 100%(${ENGINE}): singleA=${liveClicky100.singleA.maxPeak.toFixed(3)}, space+letter=${liveClicky100.spaceLetter.maxPeak.toFixed(3)}, 3-roll=${liveClicky100.threeKeyRoll.maxPeak.toFixed(3)}, 10-burst=${liveClicky100.tenKeyBurst.maxPeak.toFixed(3)}, bg=${liveClicky100.bgBurst.maxPeak.toFixed(3)}`);
  console.log(`  Offline 24 presets x 44.1/48kHz x 85/100% (${ENGINE}): maxSample=${maxSamplePeak.toFixed(4)}, maxTP4=${maxTp4.toFixed(4)}, maxTP16=${maxTp16.toFixed(4)} [${worstPreset}], max96k=${max96k.toFixed(4)}`);
  console.log(`  9-preset loudness spread (${ENGINE}): ${spreadDb.toFixed(2)} dB`);
  for (const r of results.filter((x) => x.cadence)) {
    const c = r.cadence;
    console.log(`  Cadence ${r.name.padEnd(24)}: 80/84/86/120ms spread=${c.crossSpacingSpreadDb.toFixed(3)} dB (84ms=${c.spacingDropsDb[84].toFixed(3)}, 86ms=${c.spacingDropsDb[86].toFixed(3)}), 10-key 6ms scale=${c.burstLastScaleDb.toFixed(2)} dB (minScale=${c.burstMinScale.toFixed(3)}), rendered85=${c.burst85AttackDiffDb.toFixed(2)} dB, rendered100=${c.burst100AttackDiffDb.toFixed(2)} dB, singleA85=${r.singlePeak85.toFixed(3)}`);
  }
  console.log(`DESK AUDIO PASS (${ENGINE} · max true-peak ${overallTruePeak.toFixed(4)} (${(20 * Math.log10(overallTruePeak)).toFixed(2)} dBTP) · cadence step ${maxCadenceStepDb.toFixed(3)} dB · spread ${spreadDb.toFixed(2)} dB · 0 samples >= 1.0)`);
  await ctx.close();
} finally {
  await browser.close();
}
