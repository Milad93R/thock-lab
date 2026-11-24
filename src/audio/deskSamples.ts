import { getDailyVariant, type BaseMaterial, type ClickerBuild, type SwitchType } from '../types/build';
import { prepareSwitchStroke } from './recipes';

export const DESK_PHASE_SECONDS = 0.25;
const SAMPLE_RATE = 48000;
const MAX_CACHED_BUILDS = 6;

// Target downstroke RMS over the 0.25 s phase window so switching between
// switches and bases stays within ~2 dB while leaving headroom for fast rolls.
const TARGET_DOWN_RMS = 0.064;
const MIN_TRIM = 0.55;
const MAX_TRIM = 3.15;
const BUFFER_KNEE = 0.66;
const BUFFER_CEILING = 0.80;

const SWITCH_FALLBACK_TRIM: Record<SwitchType, number> = {
  thock: 0.72,
  tactile: 1.45,
  linear: 1.55,
  bubble: 1.15,
  clicky: 1.85,
  arcade: 2.05,
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
  return Math.sign(sample) * (BUFFER_KNEE + span * Math.tanh((abs - BUFFER_KNEE) / span));
}

function calibrateDeskBuffer(buffer: AudioBuffer): AudioBuffer {
  const data = buffer.getChannelData(0);
  const phaseSamples = Math.min(data.length, Math.floor(DESK_PHASE_SECONDS * buffer.sampleRate));
  let sumSq = 0;
  for (let i = 0; i < phaseSamples; i++) sumSq += data[i] * data[i];
  const downRms = Math.sqrt(sumSq / Math.max(1, phaseSamples));
  if (downRms < 1e-5) return buffer;

  const trim = Math.max(MIN_TRIM, Math.min(MAX_TRIM, TARGET_DOWN_RMS / downRms));
  for (let i = 0; i < data.length; i++) {
    data[i] = shapePeak(data[i] * trim);
  }
  return buffer;
}

const cache = new Map<string, { buffer?: AudioBuffer }>();

export function deskSamples(build: ClickerBuild): AudioBuffer | undefined {
  const key = [build.switchType, build.baseMaterial, build.dailyVariantId].join('|');
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.buffer;
  }

  const entry: { buffer?: AudioBuffer } = {};
  cache.set(key, entry);
  if (cache.size > MAX_CACHED_BUILDS) cache.delete(cache.keys().next().value!);
  void render(build).then((buffer) => { entry.buffer = buffer; }, () => {});
  return undefined;
}

async function render(build: ClickerBuild): Promise<AudioBuffer> {
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
