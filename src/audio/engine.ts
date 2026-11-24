import { ClickerBuild, getDailyVariant } from '../types/build';
import {
  deskFallbackTrim,
  deskSamples,
  DESK_PHASE_SECONDS,
  samplePhaseEnvelope,
} from './deskSamples';
import { getNoiseBuffer, playMilestoneChime, prepareSwitchStroke } from './recipes';

const SCHEDULE_AHEAD = 0.024;
const MIN_STROKE_GAP = 0.045;

// Two-stage 4x-oversampled true-peak safety ceiling after the Studio-matched limiter.
// Both stages are linear 1:1 up to CEILING_KNEE (above Studio's 0.674 warm single-click
// peak) so single Studio and Desk strokes pass untouched. Stage 1 gently absorbs large
// multi-key sums; Stage 2 catches Stage 1's small 4x decimation-filter overshoot with
// near-zero ringing, keeping reconstructed true-peak <= -1 dBTP (<= 0.89) across all
// presets at 44.1 kHz and 48 kHz.
export const CEILING_RANGE = 4.0;
export const CEILING_KNEE = 0.675;
export const CEILING_STAGE1_MAX = 0.82;
export const CEILING_MAX = 0.775;
export const CEILING_OVERSAMPLE: OverSampleType = '4x';

// Gentle concurrent-energy headroom weight for Desk mode.
// Scales a new voice only by the actual still-sounding RMS energy of active voices
// (smoothly restoring to 1.0 as older attacks decay; zero hard window edges).
export const DESK_HEADROOM_WEIGHT = 0.32;
const FALLBACK_ATTACK_RMS = 0.26;
const FALLBACK_DECAY_TAU = 0.014;
const MAX_TRACKED_VOICES = 24;

function buildCeilingCurve(ceilingMax: number): Float32Array<ArrayBuffer> {
  const length = 4097;
  const half = (length - 1) / 2;
  const span = ceilingMax - CEILING_KNEE;
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = ((i - half) / half) * CEILING_RANGE;
    const abs = Math.abs(x);
    if (abs <= CEILING_KNEE) {
      curve[i] = x;
    } else {
      const u = (abs - CEILING_KNEE) / span;
      curve[i] = Math.sign(x) * (CEILING_KNEE + span * (u / (1 + u)));
    }
  }
  return curve;
}

let ceilingCurveStage1: Float32Array<ArrayBuffer> | null = null;
let ceilingCurveStage2: Float32Array<ArrayBuffer> | null = null;
export function getTruePeakCeilingCurve(stage: 1 | 2 = 2): Float32Array<ArrayBuffer> {
  if (stage === 1) {
    if (!ceilingCurveStage1) ceilingCurveStage1 = buildCeilingCurve(CEILING_STAGE1_MAX);
    return ceilingCurveStage1;
  }
  if (!ceilingCurveStage2) ceilingCurveStage2 = buildCeilingCurve(CEILING_MAX);
  return ceilingCurveStage2;
}

interface ActiveDeskVoice {
  startTime: number;
  rate: number;
  gain: number;
  env: Float32Array | null;
  duration: number;
}

export class DeskHeadroomTracker {
  private voices: ActiveDeskVoice[] = [];

  public reset(): void {
    this.voices.length = 0;
  }

  /**
   * Computes a smooth headroom scale in (0, 1] from the actual concurrent signal
   * energy still sounding at `time`, then records the new voice with its applied gain.
   */
  public allocate(
    time: number,
    rate: number,
    nominalGain: number,
    env: Float32Array | null,
    downAttackRms: number
  ): number {
    let keep = 0;
    let activePower = 0;

    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      const elapsed = (time - voice.startTime) * voice.rate;
      if (elapsed >= voice.duration || voice.startTime > time + 0.025) continue;
      this.voices[keep++] = voice;
      if (voice.startTime > time + 0.01) continue;

      const offset = Math.max(0, elapsed);
      const rms = voice.env
        ? samplePhaseEnvelope(voice.env, offset)
        : FALLBACK_ATTACK_RMS * Math.exp(-offset / FALLBACK_DECAY_TAU);
      const amp = voice.gain * rms;
      activePower += amp * amp;
    }
    this.voices.length = keep;

    const attackRms = env
      ? Math.max(env[0] ?? 0, downAttackRms, 1e-4)
      : FALLBACK_ATTACK_RMS;
    const refPower = Math.max((nominalGain * attackRms) ** 2, 1e-8);
    const overlapRatio = activePower / refPower;
    const scale = 1 / Math.sqrt(1 + DESK_HEADROOM_WEIGHT * overlapRatio);

    this.voices.push({
      startTime: time,
      rate,
      gain: nominalGain * scale,
      env,
      duration: DESK_PHASE_SECONDS,
    });
    if (this.voices.length > MAX_TRACKED_VOICES) this.voices.shift();
    return scale;
  }
}

class ThockAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.85;
  private muted = false;
  private broken = false;
  private clockCheck = 0;
  private pending: Array<() => void> = [];
  private deskHeadroom = new DeskHeadroomTracker();

  /** Called synchronously from trusted input so the browser can start its audio device. */
  public activate(canResume: boolean): void {
    if (this.broken) return;
    const AudioCtx = window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      if (!this.ctx) {
        const ctx = new AudioCtx({ latencyHint: 'interactive' });
        const master = ctx.createGain();
        master.gain.setValueAtTime(this.targetGain(), ctx.currentTime);
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 6;
        limiter.ratio.value = 10;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.05;
        const ceilingDrive1 = ctx.createGain();
        ceilingDrive1.gain.value = 1 / CEILING_RANGE;
        const ceiling1 = ctx.createWaveShaper();
        ceiling1.curve = getTruePeakCeilingCurve(1);
        ceiling1.oversample = CEILING_OVERSAMPLE;
        const ceilingDrive2 = ctx.createGain();
        ceilingDrive2.gain.value = 1 / CEILING_RANGE;
        const ceiling2 = ctx.createWaveShaper();
        ceiling2.curve = getTruePeakCeilingCurve(2);
        ceiling2.oversample = CEILING_OVERSAMPLE;
        master.connect(limiter);
        limiter.connect(ceilingDrive1);
        ceilingDrive1.connect(ceiling1);
        ceiling1.connect(ceilingDrive2);
        ceilingDrive2.connect(ceiling2);
        ceiling2.connect(ctx.destination);
        getNoiseBuffer(ctx);
        this.ctx = ctx;
        this.masterGain = master;
        ctx.addEventListener('statechange', this.flush);
      }

      if (canResume && this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        // An interruption or an activation-gated touch can require another trusted event.
        void this.ctx.resume().then(this.flush, () => {});
      }
      this.flush();
    } catch {
      this.broken = true;
      this.pending = [];
    }
  }

  public setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyGain();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.pending = [];
    this.applyGain();
  }

  private targetGain(): number {
    return this.muted ? 0 : this.volume;
  }

  private applyGain(): void {
    if (!this.masterGain || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.targetGain(), now, 0.012);
    } catch {
      // The audio device can become unavailable while the studio is open.
    }
  }

  private flush = (): void => {
    if (!this.pending.length || this.ctx?.state !== 'running') return;
    // "running" can be reported before the first render quantum has completed.
    if (this.ctx.currentTime === 0) {
      if (!this.clockCheck) {
        this.clockCheck = requestAnimationFrame(() => {
          this.clockCheck = 0;
          this.flush();
        });
      }
      return;
    }

    const pending = this.pending;
    this.pending = [];
    if (this.targetGain() <= 0.001) return;
    for (const play of pending) {
      try {
        play();
      } catch {
        // Synthesis errors must never break the click loop.
      }
    }
  };

  private whenReady(play: () => void): void {
    if (this.broken || this.targetGain() <= 0.001 || this.ctx?.state === 'closed') return;
    if (this.pending.length >= 32) this.pending.shift();
    this.pending.push(play);
    this.flush();
  }

  public triggerDown(build: ClickerBuild, velocity: number): () => void {
    const daily = getDailyVariant(build.dailyVariantId) ?? null;
    const type = daily?.baseSwitch ?? build.switchType;
    let downTime: number | undefined;
    const play = (phase: 'down' | 'up') => {
      const ctx = this.ctx!;
      const master = this.masterGain!;
      const start = prepareSwitchStroke(ctx, master, type, {
        phase, baseMaterial: build.baseMaterial, dailyVariant: daily,
        velocity: phase === 'down' ? velocity : undefined,
      });
      const earliest = ctx.currentTime + SCHEDULE_AHEAD;
      const time = phase === 'down' ? earliest : Math.max(earliest, downTime! + MIN_STROKE_GAP);
      start(time);
      if (phase === 'down') downTime = time;
    };

    this.whenReady(() => play('down'));
    return () => this.whenReady(() => {
      if (downTime !== undefined) play('up');
    });
  }

  public triggerDeskDown(build: ClickerBuild, touch: { rate: number; gain: number }): (released: boolean) => void {
    const sample = deskSamples(build);
    let downTime: number | undefined;
    let cancelled = false;

    const play = (phase: 'down' | 'up') => {
      const ctx = this.ctx!;
      const master = this.masterGain!;
      const earliest = () => phase === 'down'
        ? ctx.currentTime
        : Math.max(ctx.currentTime, downTime! + 0.012);

      if (sample) {
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = sample.buffer;
        source.playbackRate.value = touch.rate;
        source.connect(gain);
        gain.connect(master);
        source.onended = () => gain.disconnect();
        const time = earliest();
        const env = phase === 'down' ? sample.envDown : sample.envUp;
        const scale = this.deskHeadroom.allocate(time, touch.rate, touch.gain, env, sample.downAttackRms);
        gain.gain.value = touch.gain * scale;
        source.start(time, phase === 'down' ? 0 : DESK_PHASE_SECONDS, DESK_PHASE_SECONDS);
        return time;
      }

      // The first stroke after a build change can precede the offline render.
      // Use the same synthesis on the live graph so that stroke still starts immediately.
      const daily = getDailyVariant(build.dailyVariantId);
      const type = daily?.baseSwitch ?? build.switchType;
      const time = earliest();
      const scale = this.deskHeadroom.allocate(time, touch.rate, touch.gain, null, FALLBACK_ATTACK_RMS);
      const voiceGain = touch.gain * scale * deskFallbackTrim(type, build.baseMaterial);
      const start = prepareSwitchStroke(ctx, master, type, {
        phase, baseMaterial: build.baseMaterial, dailyVariant: daily,
        pitch: touch.rate, velocity: voiceGain,
      });
      start(time);
      return time;
    };

    this.whenReady(() => {
      if (!cancelled) downTime = play('down');
    });
    return (released) => {
      if (!released) {
        cancelled = true;
        return;
      }
      this.whenReady(() => {
        if (!cancelled && downTime !== undefined) play('up');
      });
    };
  }

  public triggerMilestone(milestone: number): void {
    this.whenReady(() => {
      const ctx = this.ctx!;
      playMilestoneChime(ctx, this.masterGain!, milestone, ctx.currentTime + SCHEDULE_AHEAD);
    });
  }
}

export const audioEngine = new ThockAudioEngine();
