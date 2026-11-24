import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:6803';
const OUT_DIR = path.resolve('qa/sounds');
fs.mkdirSync(OUT_DIR, { recursive: true });

function encodeWav(samples, sampleRate) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

/** Simple radix-2 FFT magnitude spectrum for spectral centroid calculation */
function computeSpectralCentroid(samples, sampleRate) {
  const N = 4096;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const len = Math.min(samples.length, N);
  for (let i = 0; i < len; i++) {
    // Hann window
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)));
    re[i] = samples[i] * w;
  }

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let i = 0; i < N; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const tr = wr * re[i + k + half] - wi * im[i + k + half];
        const ti = wr * im[i + k + half] + wi * re[i + k + half];
        re[i + k + half] = re[i + k] - tr;
        im[i + k + half] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
      }
    }
  }

  let num = 0;
  let den = 0;
  const halfN = N / 2;
  for (let k = 1; k < halfN; k++) {
    const mag = Math.hypot(re[k], im[k]);
    const freq = (k * sampleRate) / N;
    num += freq * mag;
    den += mag;
  }
  return den > 0 ? num / den : 0;
}

function analyzeWaveform(samples, sampleRate, downEndSec = 0.14) {
  const downLen = Math.min(samples.length, Math.floor(downEndSec * sampleRate));
  let peak = 0;
  let peakIdx = 0;
  let sumSq = 0;
  for (let i = 0; i < downLen; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) {
      peak = a;
      peakIdx = i;
    }
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / downLen);

  // Decay time: time after peak until rolling envelope stays below -20 dB (0.1 * peak)
  const threshold = peak * 0.1;
  let lastAbove = peakIdx;
  for (let i = peakIdx; i < downLen; i++) {
    if (Math.abs(samples[i]) >= threshold) lastAbove = i;
  }
  const decayMs = ((lastAbove - peakIdx) / sampleRate) * 1000;

  // Analyze key-up segment (starts at 0.18s)
  const upStart = Math.floor(0.175 * sampleRate);
  let upPeak = 0;
  for (let i = upStart; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > upPeak) upPeak = a;
  }

  const centroidHz = computeSpectralCentroid(samples.slice(0, downLen), sampleRate);
  const upCentroidHz = computeSpectralCentroid(samples.slice(upStart), sampleRate);

  return {
    peak: Number(peak.toFixed(4)),
    rms: Number(rms.toFixed(4)),
    decayMs: Number(decayMs.toFixed(1)),
    centroidHz: Math.round(centroidHz),
    upPeak: Number(upPeak.toFixed(4)),
    upCentroidHz: Math.round(upCentroidHz),
  };
}

async function main() {
  // Pure Web Audio rendering: no WebGL, no app UI.
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/favicon.svg`, { waitUntil: 'domcontentloaded' });

    const cases = [
      { id: 'thock', sw: 'thock', base: 'wood' },
      { id: 'clicky', sw: 'clicky', base: 'plastic' },
      { id: 'tactile', sw: 'tactile', base: 'plastic' },
      { id: 'linear', sw: 'linear', base: 'plastic' },
      { id: 'bubble', sw: 'bubble', base: 'plastic' },
      { id: 'arcade', sw: 'arcade', base: 'plastic' },
      { id: 'base-wood', sw: 'tactile', base: 'wood' },
      { id: 'base-aluminum', sw: 'tactile', base: 'aluminum' },
      { id: 'base-acrylic', sw: 'tactile', base: 'acrylic' },
      { id: 'base-plastic', sw: 'tactile', base: 'plastic' },
    ];

    const rendered = await page.evaluate(async (testCases) => {
      const mod = await import('/src/audio/recipes.ts');
      const sampleRate = 44100;
      const durationSec = 0.34;
      const results = [];

      function seededRng(seed) {
        let s = seed >>> 0;
        return () => {
          s = (Math.imul(1664525, s) + 1013904223) >>> 0;
          return s / 4294967296;
        };
      }

      for (let i = 0; i < testCases.length; i++) {
        const c = testCases[i];
        const offline = new OfflineAudioContext(1, Math.floor(sampleRate * durationSec), sampleRate);
        const rng = seededRng(1337 + i * 97);

        // Key-down at t=0.01s, Key-up at t=0.18s
        mod.prepareSwitchStroke(offline, offline.destination, c.sw, {
          phase: 'down',
          baseMaterial: c.base,
          rand: rng,
        })(0.01);
        mod.prepareSwitchStroke(offline, offline.destination, c.sw, {
          phase: 'up',
          baseMaterial: c.base,
          rand: rng,
        })(0.18);

        const buf = await offline.startRendering();
        const ch = buf.getChannelData(0);
        results.push({
          id: c.id,
          sw: c.sw,
          base: c.base,
          sampleRate,
          samples: Array.from(ch),
        });
      }
      return results;
    }, cases);

    const metrics = {};
    console.log('\n=== OFFLINE WEB AUDIO SYNTHESIS VERIFICATION ===');
    console.log(
      'Recipe'.padEnd(16),
      'Peak'.padEnd(8),
      'RMS'.padEnd(8),
      'Decay(ms)'.padEnd(11),
      'Centroid(Hz)'.padEnd(14),
      'UpPeak'.padEnd(8),
      'UpCentroid(Hz)'
    );

    for (const r of rendered) {
      const m = analyzeWaveform(r.samples, r.sampleRate);
      metrics[r.id] = m;
      const wavPath = path.join(OUT_DIR, `${r.id}.wav`);
      fs.writeFileSync(wavPath, encodeWav(r.samples, r.sampleRate));
      console.log(
        r.id.padEnd(16),
        String(m.peak).padEnd(8),
        String(m.rms).padEnd(8),
        String(m.decayMs).padEnd(11),
        String(m.centroidHz).padEnd(14),
        String(m.upPeak).padEnd(8),
        String(m.upCentroidHz)
      );
    }

    // Strict assertions
    const failures = [];
    for (const [id, m] of Object.entries(metrics)) {
      if (m.peak >= 0.98) failures.push(`${id}: clipped! peak=${m.peak}`);
      if (m.peak < 0.08) failures.push(`${id}: too quiet! peak=${m.peak}`);
      if (m.upPeak <= 0.01) failures.push(`${id}: missing key-up sound! upPeak=${m.upPeak}`);
      if (m.upPeak >= m.peak) failures.push(`${id}: key-up louder than key-down!`);
      if (m.upCentroidHz <= m.centroidHz) failures.push(`${id}: key-up (${m.upCentroidHz} Hz) must be higher than key-down (${m.centroidHz} Hz)`);
    }

    if (metrics.thock.centroidHz >= 950) {
      failures.push(`thock centroid too bright (${metrics.thock.centroidHz} Hz, expected < 950 Hz)`);
    }
    if (metrics.clicky.centroidHz <= 2200) {
      failures.push(`clicky centroid not crisp enough (${metrics.clicky.centroidHz} Hz, expected > 2200 Hz)`);
    }
    if (metrics.thock.centroidHz * 2.5 >= metrics.clicky.centroidHz) {
      failures.push(`thock (${metrics.thock.centroidHz} Hz) and clicky (${metrics.clicky.centroidHz} Hz) not distinct enough`);
    }
    if (metrics['base-wood'].centroidHz >= metrics['base-aluminum'].centroidHz) {
      failures.push(
        `wood (${metrics['base-wood'].centroidHz} Hz) should be warmer than aluminum (${metrics['base-aluminum'].centroidHz} Hz)`
      );
    }
    if (metrics.arcade.centroidHz <= metrics.thock.centroidHz * 1.5) {
      failures.push(`arcade (${metrics.arcade.centroidHz} Hz) should be sharper than thock (${metrics.thock.centroidHz} Hz)`);
    }

    fs.writeFileSync(
      path.join(OUT_DIR, 'metrics.json'),
      JSON.stringify(metrics, null, 2)
    );

    if (failures.length > 0) {
      console.error('\nAUDIO VERIFICATION FAILED:\n- ' + failures.join('\n- '));
      process.exitCode = 1;
    } else {
      console.log('\nAUDIO VERIFICATION PASSED — all recipes distinct, warm/crisp as designed, zero clipping.');
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
