import { getDailyVariant, type BaseMaterial, type ClickerBuild, type SwitchType } from '../types/build';
import { prepareSwitchStroke } from './recipes';

export const DESK_PHASE_SECONDS = 0.25;
export const DESK_ENV_STEP_SECONDS = 0.001;
const DESK_ENV_WINDOW_SECONDS = 0.01;
const SAMPLE_RATE = 48000;
const MAX_CACHED_BUILDS = 6;

// Target downstroke RMS over the 0.25 s phase window so switching between
// switches and bases stays within ~2 dB while leaving headroom for fast rolls.
const TARGET_DOWN_RMS = 0.068;
const MIN_TRIM = 0.55;
const MAX_TRIM = 3.15;
const BUFFER_KNEE = 0.56;
const BUFFER_CEILING = 0.7;

export interface DeskSampleSet {
  buffer: AudioBuffer;
  envDown: Float32Array;
  envUp: Float32Array;
  downAttackRms: number;
}

const SWITCH_FALLBACK_TRIM: Record<SwitchType, number> = {
  thock: 0.76,
  tactile: 1.52,
  linear: 1.62,
  bubble: 1.2,
  clicky: 1.92,
  arcade: 2.12,
};

const BASE_FALLBACK_TRIM: Record<BaseMaterial, number> = {
  wood: 0.86,
  aluminum: 1.0,
  plastic: 1.06,
  acrylic: 1.14,
};

export function deskFallbackTrim(type: SwitchType, base: BaseMaterial): number {
  return Math.max(MIN_TRIM, Math.min(MAX_TRIM, SWITCH_FALLBACK_TRIM[type] * BASE_FALLBACK_TRIM[base]));
}

function shapePeak(sample: number): number {
  const abs = Math.abs(sample);
  if (abs <= BUFFER_KNEE) return sample;
  const span = BUFFER_CEILING - BUFFER_KNEE;
  const u = (abs - BUFFER_KNEE) / span;
  return Math.sign(sample) * (BUFFER_KNEE + span * (u / (1 + u)));
}

/**
 * Computes a smooth decaying RMS envelope (10 ms forward window sampled every 1 ms)
 * for one rendered Desk stroke phase so headroom tracks actual sounding energy.
 */
export function computePhaseEnvelope(
  data: Float32Array,
  startSample: number,
  phaseSamples: number,
  sampleRate: number
): Float32Array {
  const stepSamples = Math.max(1, Math.round(DESK_ENV_STEP_SECONDS * sampleRate));
  const windowSamples = Math.max(1, Math.round(DESK_ENV_WINDOW_SECONDS * sampleRate));
  const steps = Math.ceil(phaseSamples / stepSamples) + 1;
  const prefix = new Float64Array(phaseSamples + 1);
  for (let i = 0; i < phaseSamples; i++) {
    const v = data[startSample + i] ?? 0;
    prefix[i + 1] = prefix[i] + v * v;
  }
  const env = new Float32Array(steps);
  for (let k = 0; k < steps; k++) {
    const from = Math.min(phaseSamples, k * stepSamples);
    const to = Math.min(phaseSamples, from + windowSamples);
    const sumSq = Math.max(0, prefix[to] - prefix[from]);
    env[k] = Math.sqrt(sumSq / windowSamples);
  }
  return env;
}

export function samplePhaseEnvelope(env: Float32Array, offsetSeconds: number): number {
  if (offsetSeconds <= 0) return env[0] ?? 0;
  const pos = offsetSeconds / DESK_ENV_STEP_SECONDS;
  const idx = Math.floor(pos);
  if (idx >= env.length - 1) return 0;
  const frac = pos - idx;
  return env[idx] * (1 - frac) + env[idx + 1] * frac;
}

export function calibrateDeskBuffer(buffer: AudioBuffer): DeskSampleSet {
  const data = buffer.getChannelData(0);
  const phaseSamples = Math.min(data.length, Math.floor(DESK_PHASE_SECONDS * buffer.sampleRate));
  let sumSq = 0;
  for (let i = 0; i < phaseSamples; i++) sumSq += data[i] * data[i];
  const downRms = Math.sqrt(sumSq / Math.max(1, phaseSamples));
  if (downRms >= 1e-5) {
    const trim = Math.max(MIN_TRIM, Math.min(MAX_TRIM, TARGET_DOWN_RMS / downRms));
    for (let i = 0; i < data.length; i++) {
      data[i] = shapePeak(data[i] * trim);
    }
  }

  const envDown = computePhaseEnvelope(data, 0, phaseSamples, buffer.sampleRate);
  const upStart = Math.min(data.length, phaseSamples);
  const upLen = Math.min(phaseSamples, Math.max(0, data.length - upStart));
  const envUp = computePhaseEnvelope(data, upStart, upLen, buffer.sampleRate);
  let downPeakRms = 1e-4;
  for (let i = 0; i < envDown.length; i++) {
    if (envDown[i] > downPeakRms) downPeakRms = envDown[i];
  }
  return {
    buffer,
    envDown,
    envUp,
    downAttackRms: downPeakRms,
  };
}

const cache = new Map<string, { sample?: DeskSampleSet }>();

export function deskSamples(build: ClickerBuild): DeskSampleSet | undefined {
  const key = [build.switchType, build.baseMaterial, build.dailyVariantId].join('|');
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.sample;
  }

  const entry: { sample?: DeskSampleSet } = {};
  cache.set(key, entry);
  if (cache.size > MAX_CACHED_BUILDS) cache.delete(cache.keys().next().value!);
  void render(build).then((sample) => { entry.sample = sample; }, () => {});
  return undefined;
}

async function render(build: ClickerBuild): Promise<DeskSampleSet> {
  const OfflineContext = window.OfflineAudioContext ??
    (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OfflineContext(1, SAMPLE_RATE * DESK_PHASE_SECONDS * 2, SAMPLE_RATE);
  const daily = getDailyVariant(build.dailyVariantId);
  const type = daily?.baseSwitch ?? build.switchType;
  prepareSwitchStroke(ctx, ctx.destination, type, {
    phase: 'down', baseMaterial: build.baseMaterial, dailyVariant: daily,
  })(0);
  prepareSwitchStroke(ctx, ctx.destination, type, {
    phase: 'up', baseMaterial: build.baseMaterial, dailyVariant: daily,
  })(DESK_PHASE_SECONDS);
  return calibrateDeskBuffer(await ctx.startRendering());
}
