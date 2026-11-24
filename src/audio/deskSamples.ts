import { getDailyVariant, type ClickerBuild } from '../types/build';
import { prepareSwitchStroke } from './recipes';

export const DESK_PHASE_SECONDS = 0.25;
const SAMPLE_RATE = 48000;
const MAX_CACHED_BUILDS = 6;

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
  return ctx.startRendering();
}
