import {
  BaseMaterial,
  DailySwitchVariant,
  SwitchType,
} from '../types/build';

export interface RecipeOptions {
  /** Key phase: 'down' (press) or 'up' (release) */
  phase: 'down' | 'up';
  /** Base material coloring the chamber acoustics */
  baseMaterial: BaseMaterial;
  /** Optional Switch of the Day acoustic variant */
  dailyVariant?: DailySwitchVariant | null;
  /** Optional deterministic random generator [0, 1) for testing */
  rand?: () => number;
  /** Velocity / combo intensity multiplier (default 1.0) */
  velocity?: number;
}

type StrokeLayer = (startTime: number) => void;
type AddStrokeLayer = (layer: StrokeLayer) => void;

type SwitchRecipeFn = (
  ctx: BaseAudioContext,
  bus: AudioNode,
  options: RecipeOptions,
  addLayer: AddStrokeLayer
) => void;

// Cache reusable white noise buffers per AudioContext (WeakMap prevents leaks across OfflineAudioContexts)
const noiseBufferCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function getNoiseBuffer(ctx: BaseAudioContext, rand = Math.random): AudioBuffer {
  const reusable = rand === Math.random;
  if (reusable) {
    const cached = noiseBufferCache.get(ctx);
    if (cached) return cached;
  }
  const length = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = rand() * 2 - 1;
  }
  if (reusable) {
    noiseBufferCache.set(ctx, buffer);
  }
  return buffer;
}

/** ±4% organic pitch and gain humanization */
function jitter(rand: () => number, amount = 0.04): number {
  return 1 + (rand() * 2 - 1) * amount;
}

function clampFreq(ctx: BaseAudioContext, freq: number): number {
  return Math.max(28, Math.min(ctx.sampleRate * 0.45, freq));
}

// Soft-clip transfer curve is identical for every chain: compute it once.
let softClipCurve: Float32Array<ArrayBuffer> | null = null;
function getSoftClipCurve(): Float32Array<ArrayBuffer> {
  if (!softClipCurve) {
    const curveLen = 1024;
    softClipCurve = new Float32Array(curveLen);
    for (let i = 0; i < curveLen; i++) {
      const x = (i * 2) / curveLen - 1;
      softClipCurve[i] = Math.tanh(x * 1.15) * 0.9;
    }
  }
  return softClipCurve;
}

// One persistent coloration bus per (destination, base material, daily variant).
// Strokes connect their short-lived sources into the shared bus instead of
// allocating 3–6 filters + a WaveShaper on every key-down and key-up.
const busCache = new WeakMap<AudioNode, Map<string, AudioNode>>();

/**
 * Returns (creating once) the acoustic coloration bus for the selected base housing
 * (and optional Switch of the Day modifier), feeding `destination`.
 */
export function getBaseColorationBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  baseMaterial: BaseMaterial,
  dailyVariant?: DailySwitchVariant | null
): AudioNode {
  let perDest = busCache.get(destination);
  if (!perDest) {
    perDest = new Map();
    busCache.set(destination, perDest);
  }
  const key = `${baseMaterial}|${dailyVariant ? dailyVariant.id : '-'}`;
  const existing = perDest.get(key);
  if (existing && existing.context === ctx) return existing;
  const bus = createBaseColorationChain(ctx, destination, baseMaterial, dailyVariant);
  perDest.set(key, bus);
  return bus;
}

/**
 * Builds the acoustic coloration filter chain for the selected base housing
 * (and optional Switch of the Day modifier), returning the input AudioNode.
 */
export function createBaseColorationChain(
  ctx: BaseAudioContext,
  destination: AudioNode,
  baseMaterial: BaseMaterial,
  dailyVariant?: DailySwitchVariant | null
): AudioNode {
  const input = ctx.createGain();
  input.gain.value = 1.0;

  let head: AudioNode = input;

  if (baseMaterial === 'wood') {
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowshelf';
    warmth.frequency.value = 260;
    warmth.gain.value = 4.2;

    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 440;
    body.Q.value = 0.9;
    body.gain.value = 1.6;

    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 4100;
    damp.Q.value = 0.65;

    head.connect(warmth);
    warmth.connect(body);
    body.connect(damp);
    head = damp;
  } else if (baseMaterial === 'aluminum') {
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3100;
    presence.Q.value = 1.3;
    presence.gain.value = 4.6;

    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 5000;
    air.gain.value = 3.2;

    const tightLow = ctx.createBiquadFilter();
    tightLow.type = 'highpass';
    tightLow.frequency.value = 95;
    tightLow.Q.value = 0.7;

    head.connect(tightLow);
    tightLow.connect(presence);
    presence.connect(air);
    head = air;
  } else if (baseMaterial === 'acrylic') {
    const scoop = ctx.createBiquadFilter();
    scoop.type = 'peaking';
    scoop.frequency.value = 270;
    scoop.Q.value = 1.1;
    scoop.gain.value = -2.8;

    const hollow = ctx.createBiquadFilter();
    hollow.type = 'peaking';
    hollow.frequency.value = 840;
    hollow.Q.value = 2.6;
    hollow.gain.value = 5.4;

    const sheen = ctx.createBiquadFilter();
    sheen.type = 'lowpass';
    sheen.frequency.value = 6200;
    sheen.Q.value = 0.7;

    head.connect(scoop);
    scoop.connect(hollow);
    hollow.connect(sheen);
    head = sheen;
  } else {
    // Pastel ABS plastic: balanced snappy neutral
    const punch = ctx.createBiquadFilter();
    punch.type = 'peaking';
    punch.frequency.value = 1280;
    punch.Q.value = 1.0;
    punch.gain.value = 1.8;

    const smoothTop = ctx.createBiquadFilter();
    smoothTop.type = 'lowpass';
    smoothTop.frequency.value = 7400;

    head.connect(punch);
    punch.connect(smoothTop);
    head = smoothTop;
  }

  if (dailyVariant) {
    const res = ctx.createBiquadFilter();
    res.type = 'peaking';
    res.frequency.value = clampFreq(ctx, 520 * dailyVariant.bodyFreqMult);
    res.Q.value = 1.8;
    res.gain.value = dailyVariant.resonanceBoost;

    const tilt = ctx.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = 2600;
    tilt.gain.value = (dailyVariant.clickBrightMult - 1) * 8;

    head.connect(res);
    res.connect(tilt);
    head = tilt;
  }

  // Gentle soft-clipping ceiling so rapid overlapping strokes never clip > 0 dBFS
  const shaper = ctx.createWaveShaper();
  shaper.curve = getSoftClipCurve();
  shaper.oversample = '2x';

  head.connect(shaper);
  shaper.connect(destination);

  return input;
}

function prepareNoiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  addLayer: AddStrokeLayer,
  opts: {
    delay?: number;
    duration: number;
    filterType: BiquadFilterType;
    frequency: number;
    q: number;
    gain: number;
    attack?: number;
    rand?: () => number;
  }
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx, opts.rand);

  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.value = clampFreq(ctx, opts.frequency);
  filter.Q.value = opts.q;

  const env = ctx.createGain();
  const attack = opts.attack ?? 0.0012;
  src.connect(filter);
  filter.connect(env);
  env.connect(dest);

  const offset = (opts.rand ? opts.rand() : Math.random()) * 0.08;
  addLayer((startTime) => {
    const time = startTime + (opts.delay ?? 0);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(opts.gain, time + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, time + opts.duration);
    src.start(time, offset, opts.duration + 0.015);
    src.stop(time + opts.duration + 0.02);
  });
}

function prepareToneSweep(
  ctx: BaseAudioContext,
  dest: AudioNode,
  addLayer: AddStrokeLayer,
  opts: {
    delay?: number;
    duration: number;
    type: OscillatorType;
    startFreq: number;
    endFreq: number;
    gain: number;
    attack?: number;
    lowpass?: number;
  }
): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  const startFreq = clampFreq(ctx, opts.startFreq);
  const endFreq = clampFreq(ctx, opts.endFreq);
  const env = ctx.createGain();
  const attack = opts.attack ?? 0.0018;

  if (opts.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clampFreq(ctx, opts.lowpass);
    osc.connect(lp);
    lp.connect(env);
  } else {
    osc.connect(env);
  }
  env.connect(dest);

  addLayer((startTime) => {
    const time = startTime + (opts.delay ?? 0);
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + opts.duration * 0.78);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(opts.gain, time + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, time + opts.duration);
    osc.start(time);
    osc.stop(time + opts.duration + 0.015);
  });
}

/**
 * 1. DEEP THOCK — Creamy, resonant, marbly lubed POM/PC bottom-out.
 * Low spectral centroid (~450–700 Hz), lush sub-body + hollow formant, hushed top-out.
 */
const prepareDeepThockRecipe: SwitchRecipeFn = (ctx, bus, opts, addLayer) => {
  const rng = opts.rand ?? Math.random;
  const pJit = jitter(rng, 0.04) * (opts.dailyVariant?.pitchMult ?? 1);
  const gJit = jitter(rng, 0.04) * (opts.velocity ?? 1);
  const bodyMult = opts.dailyVariant?.bodyFreqMult ?? 1;
  const tail = opts.dailyVariant?.tailMult ?? 1;

  if (opts.phase === 'down') {
    // Deep velvety sub-thump
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.088 * tail,
      type: 'sine',
      startFreq: 215 * pJit * bodyMult,
      endFreq: 76 * pJit * bodyMult,
      gain: 0.62 * gJit,
      attack: 0.0022,
    });

    // Creamy low-mid "marbly" body formant
    prepareToneSweep(ctx, bus, addLayer, {
      delay: 0.001,
      duration: 0.056 * tail,
      type: 'triangle',
      startFreq: 470 * pJit * bodyMult,
      endFreq: 210 * pJit * bodyMult,
      gain: 0.34 * gJit,
      attack: 0.002,
      lowpass: 680 * bodyMult,
    });

    // Hollow switch housing cavity knock
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.048 * tail,
      filterType: 'bandpass',
      frequency: 420 * pJit * bodyMult,
      q: 3.6,
      gain: 0.44 * gJit,
      attack: 0.0015,
      rand: rng,
    });

    // Soft lubed stem transient (no harsh highs)
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.016,
      filterType: 'bandpass',
      frequency: 1050 * pJit,
      q: 1.6,
      gain: 0.16 * gJit,
      attack: 0.001,
      rand: rng,
    });
  } else {
    // Quieter, slightly higher creamy key-up "plock"
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.036 * tail,
      type: 'sine',
      startFreq: 520 * pJit,
      endFreq: 310 * pJit,
      gain: 0.19 * gJit,
      attack: 0.0015,
    });
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.022,
      filterType: 'bandpass',
      frequency: 1380 * pJit,
      q: 2.2,
      gain: 0.15 * gJit,
      rand: rng,
    });
  }
};

/**
 * 2. CLICKY — Crisp MX-Blue style click-jacket twin snap + bright metallic ping.
 * High spectral centroid (~2,700–4,200 Hz), tight dry decay.
 */
const prepareClickyRecipe: SwitchRecipeFn = (ctx, bus, opts, addLayer) => {
  const rng = opts.rand ?? Math.random;
  const pJit = jitter(rng, 0.04) * (opts.dailyVariant?.pitchMult ?? 1);
  const gJit = jitter(rng, 0.04) * (opts.velocity ?? 1);
  const bright = opts.dailyVariant?.clickBrightMult ?? 1;
  const tail = opts.dailyVariant?.tailMult ?? 1;

  if (opts.phase === 'down') {
    // Primary sharp click-jacket snap
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.011,
      filterType: 'bandpass',
      frequency: 4500 * pJit * bright,
      q: 2.2,
      gain: 0.56 * gJit,
      attack: 0.0005,
      rand: rng,
    });

    // Secondary micro-snap 3.5ms later (jacket hitting housing)
    prepareNoiseBurst(ctx, bus, addLayer, {
      delay: 0.0035,
      duration: 0.009,
      filterType: 'highpass',
      frequency: 3600 * pJit * bright,
      q: 1.4,
      gain: 0.34 * gJit,
      attack: 0.0004,
      rand: rng,
    });

    // Crisp metallic leaf ping
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.018 * tail,
      type: 'triangle',
      startFreq: 3850 * pJit * bright,
      endFreq: 2600 * pJit * bright,
      gain: 0.24 * gJit,
      attack: 0.0005,
    });

    // Tight dry bottom-out tap
    prepareToneSweep(ctx, bus, addLayer, {
      delay: 0.004,
      duration: 0.032 * tail,
      type: 'sine',
      startFreq: 270 * pJit,
      endFreq: 135 * pJit,
      gain: 0.30 * gJit,
      attack: 0.001,
    });
  } else {
    // Bright crisp key-up tick
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.008,
      filterType: 'bandpass',
      frequency: 5100 * pJit * bright,
      q: 2.4,
      gain: 0.24 * gJit,
      attack: 0.0005,
      rand: rng,
    });
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.014,
      type: 'sine',
      startFreq: 2900 * pJit,
      endFreq: 2100 * pJit,
      gain: 0.11 * gJit,
      attack: 0.0006,
    });
  }
};

/**
 * 3. TACTILE — Rounded mid-stroke bump followed by punchy PBT bottom-out.
 * Balanced mid-range spectral centroid (~1,150–1,800 Hz).
 */
const prepareTactileRecipe: SwitchRecipeFn = (ctx, bus, opts, addLayer) => {
  const rng = opts.rand ?? Math.random;
  const pJit = jitter(rng, 0.04) * (opts.dailyVariant?.pitchMult ?? 1);
  const gJit = jitter(rng, 0.04) * (opts.velocity ?? 1);
  const bodyMult = opts.dailyVariant?.bodyFreqMult ?? 1;
  const tail = opts.dailyVariant?.tailMult ?? 1;

  if (opts.phase === 'down') {
    // Rounded tactile bump knock (occurs slightly ahead of bottom-out)
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.013,
      filterType: 'bandpass',
      frequency: 1280 * pJit,
      q: 2.6,
      gain: 0.32 * gJit,
      attack: 0.0009,
      rand: rng,
    });

    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.022,
      type: 'triangle',
      startFreq: 720 * pJit,
      endFreq: 410 * pJit,
      gain: 0.22 * gJit,
      attack: 0.001,
    });

    // Punchy PBT bottom-out 7ms after bump
    prepareToneSweep(ctx, bus, addLayer, {
      delay: 0.007,
      duration: 0.052 * tail,
      type: 'sine',
      startFreq: 255 * pJit * bodyMult,
      endFreq: 112 * pJit * bodyMult,
      gain: 0.48 * gJit,
      attack: 0.0014,
    });

    prepareNoiseBurst(ctx, bus, addLayer, {
      delay: 0.007,
      duration: 0.016,
      filterType: 'bandpass',
      frequency: 2200 * pJit,
      q: 1.9,
      gain: 0.34 * gJit,
      attack: 0.0008,
      rand: rng,
    });
  } else {
    // Clean higher PBT top-out
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.012,
      filterType: 'bandpass',
      frequency: 2450 * pJit,
      q: 2.0,
      gain: 0.20 * gJit,
      rand: rng,
    });
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.024,
      type: 'triangle',
      startFreq: 860 * pJit,
      endFreq: 520 * pJit,
      gain: 0.14 * gJit,
      attack: 0.001,
    });
  }
};

/**
 * 4. LINEAR — Silky lubed rail glide with smooth muted bottom-out and whisper-quiet release.
 * Clean, restrained spectral centroid (~750–1,150 Hz), shortest crisp noise floor.
 */
const prepareLinearRecipe: SwitchRecipeFn = (ctx, bus, opts, addLayer) => {
  const rng = opts.rand ?? Math.random;
  const pJit = jitter(rng, 0.04) * (opts.dailyVariant?.pitchMult ?? 1);
  const gJit = jitter(rng, 0.04) * (opts.velocity ?? 1);
  const bodyMult = opts.dailyVariant?.bodyFreqMult ?? 1;
  const tail = opts.dailyVariant?.tailMult ?? 1;

  if (opts.phase === 'down') {
    // Soft silky slide brush
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.022,
      filterType: 'bandpass',
      frequency: 1180 * pJit,
      q: 1.1,
      gain: 0.14 * gJit,
      attack: 0.003,
      rand: rng,
    });

    // Clean, muted velvety bottom-out
    prepareToneSweep(ctx, bus, addLayer, {
      delay: 0.002,
      duration: 0.044 * tail,
      type: 'sine',
      startFreq: 245 * pJit * bodyMult,
      endFreq: 118 * pJit * bodyMult,
      gain: 0.44 * gJit,
      attack: 0.0022,
    });

    // Subtle nylon housing resonance
    prepareToneSweep(ctx, bus, addLayer, {
      delay: 0.002,
      duration: 0.028 * tail,
      type: 'sine',
      startFreq: 610 * pJit,
      endFreq: 390 * pJit,
      gain: 0.18 * gJit,
      attack: 0.0018,
    });
  } else {
    // Whisper-soft airy release
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.024,
      type: 'sine',
      startFreq: 720 * pJit,
      endFreq: 490 * pJit,
      gain: 0.12 * gJit,
      attack: 0.002,
    });
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.015,
      filterType: 'bandpass',
      frequency: 1550 * pJit,
      q: 1.5,
      gain: 0.09 * gJit,
      attack: 0.002,
      rand: rng,
    });
  }
};

/**
 * 5. BUBBLE POP — Juicy upward pitch-swept acoustic bubble pop + liquid droplet overtone.
 * Distinct upward frequency chirp & bouncy decay (~900–1,450 Hz centroid).
 */
const prepareBubblePopRecipe: SwitchRecipeFn = (ctx, bus, opts, addLayer) => {
  const rng = opts.rand ?? Math.random;
  const pJit = jitter(rng, 0.04) * (opts.dailyVariant?.pitchMult ?? 1);
  const gJit = jitter(rng, 0.04) * (opts.velocity ?? 1);
  const tail = opts.dailyVariant?.tailMult ?? 1;

  if (opts.phase === 'down') {
    // Iconic upward bubble-pop chirp
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.062 * tail,
      type: 'sine',
      startFreq: 175 * pJit,
      endFreq: 760 * pJit,
      gain: 0.52 * gJit,
      attack: 0.002,
    });

    // Sparkling droplet harmonic overtone
    prepareToneSweep(ctx, bus, addLayer, {
      delay: 0.006,
      duration: 0.046 * tail,
      type: 'sine',
      startFreq: 440 * pJit,
      endFreq: 1320 * pJit,
      gain: 0.22 * gJit,
      attack: 0.0025,
    });

    // Hollow soft air pop
    prepareNoiseBurst(ctx, bus, addLayer, {
      delay: 0.003,
      duration: 0.016,
      filterType: 'bandpass',
      frequency: 1450 * pJit,
      q: 3.0,
      gain: 0.24 * gJit,
      attack: 0.0012,
      rand: rng,
    });
  } else {
    // Higher playful mini-plop on release
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.036 * tail,
      type: 'sine',
      startFreq: 430 * pJit,
      endFreq: 1020 * pJit,
      gain: 0.20 * gJit,
      attack: 0.0016,
    });
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.01,
      filterType: 'bandpass',
      frequency: 2100 * pJit,
      q: 2.5,
      gain: 0.09 * gJit,
      rand: rng,
    });
  }
};

/**
 * 6. RETRO ARCADE — Short-throw Sanwa microswitch leaf click + hollow ABS cabinet clack.
 * Fast crisp decay, high-mid snap + distinctive 700 Hz hollow button body (~1,800–2,700 Hz).
 */
const prepareRetroArcadeRecipe: SwitchRecipeFn = (ctx, bus, opts, addLayer) => {
  const rng = opts.rand ?? Math.random;
  const pJit = jitter(rng, 0.04) * (opts.dailyVariant?.pitchMult ?? 1);
  const gJit = jitter(rng, 0.04) * (opts.velocity ?? 1);
  const bright = opts.dailyVariant?.clickBrightMult ?? 1;
  const tail = opts.dailyVariant?.tailMult ?? 1;

  if (opts.phase === 'down') {
    // Ultra-fast microswitch leaf click
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.007,
      filterType: 'highpass',
      frequency: 3400 * pJit * bright,
      q: 1.5,
      gain: 0.46 * gJit,
      attack: 0.0004,
      rand: rng,
    });

    // Crisp metallic switch contact ping
    prepareToneSweep(ctx, bus, addLayer, {
      duration: 0.012,
      type: 'square',
      startFreq: 2650 * pJit * bright,
      endFreq: 1950 * pJit * bright,
      gain: 0.14 * gJit,
      attack: 0.0004,
      lowpass: 4800,
    });

    // Hollow ABS arcade button cabinet clack
    prepareNoiseBurst(ctx, bus, addLayer, {
      delay: 0.002,
      duration: 0.032 * tail,
      filterType: 'bandpass',
      frequency: 720 * pJit,
      q: 5.8,
      gain: 0.42 * gJit,
      attack: 0.0008,
      rand: rng,
    });

    // Short snappy arcade bottom punch
    prepareToneSweep(ctx, bus, addLayer, {
      delay: 0.002,
      duration: 0.026 * tail,
      type: 'triangle',
      startFreq: 350 * pJit,
      endFreq: 175 * pJit,
      gain: 0.34 * gJit,
      attack: 0.0008,
    });
  } else {
    // Snappy spring-return leaf tick: higher and quieter than the press
    prepareNoiseBurst(ctx, bus, addLayer, {
      duration: 0.008,
      filterType: 'highpass',
      frequency: 5200 * pJit * bright,
      q: 1.3,
      gain: 0.24 * gJit,
      attack: 0.0004,
      rand: rng,
    });
    prepareToneSweep(ctx, bus, addLayer, {
      delay: 0.002,
      duration: 0.014,
      type: 'triangle',
      startFreq: 3300 * pJit * bright,
      endFreq: 2500 * pJit * bright,
      gain: 0.1 * gJit,
      attack: 0.0005,
    });
  }
};

const SWITCH_RECIPES: Record<SwitchType, SwitchRecipeFn> = {
  thock: prepareDeepThockRecipe,
  clicky: prepareClickyRecipe,
  tactile: prepareTactileRecipe,
  linear: prepareLinearRecipe,
  bubble: prepareBubblePopRecipe,
  arcade: prepareRetroArcadeRecipe,
};

/** Prepare every layer before the caller reads the audio clock for this stroke. */
export function prepareSwitchStroke(
  ctx: BaseAudioContext,
  destination: AudioNode,
  type: SwitchType,
  options: RecipeOptions
): StrokeLayer {
  const bus = getBaseColorationBus(ctx, destination, options.baseMaterial, options.dailyVariant);
  const layers: StrokeLayer[] = [];
  SWITCH_RECIPES[type](ctx, bus, options, (layer) => layers.push(layer));
  return (startTime) => {
    for (const layer of layers) layer(startTime);
  };
}

/**
 * Celebratory marimba-like harmonic chime for 25, 50, 100 combo milestones.
 */
export function playMilestoneChime(
  ctx: BaseAudioContext,
  destination: AudioNode,
  milestone: number,
  time: number
): void {
  const notes =
    milestone >= 100
      ? [523.25, 659.25, 783.99, 1046.5]
      : milestone >= 50
        ? [523.25, 659.25, 783.99]
        : [523.25, 659.25];

  notes.forEach((freq, idx) => {
    const start = time + idx * 0.055;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(0.14, start + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);

    osc.connect(env);
    env.connect(destination);
    osc.start(start);
    osc.stop(start + 0.26);
  });
}
