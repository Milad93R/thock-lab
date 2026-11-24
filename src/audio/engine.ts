import { ClickerBuild, getDailyVariant } from '../types/build';
import { deskFallbackTrim, deskSamples, DESK_PHASE_SECONDS } from './deskSamples';
import { getNoiseBuffer, playMilestoneChime, prepareSwitchStroke } from './recipes';

const SCHEDULE_AHEAD = 0.024;
const MIN_STROKE_GAP = 0.045;
const DESK_OVERLAP_WINDOW = 0.085;

// True peak safety ceiling after the dynamics limiter.
// Linear 1:1 up to CEILING_KNEE so single-stroke attacks stay transparent,
// then smoothly saturates asymptotically toward CEILING_MAX (< 0.98).
const CEILING_RANGE = 4.0;
const CEILING_KNEE = 0.78;
const CEILING_MAX = 0.95;

let ceilingCurve: Float32Array<ArrayBuffer> | null = null;
function getTruePeakCeilingCurve(): Float32Array<ArrayBuffer> {
  if (!ceilingCurve) {
    const length = 4097;
    const half = (length - 1) / 2;
    const span = CEILING_MAX - CEILING_KNEE;
    ceilingCurve = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const x = ((i - half) / half) * CEILING_RANGE;
      const abs = Math.abs(x);
      if (abs <= CEILING_KNEE) {
        ceilingCurve[i] = x;
      } else {
        ceilingCurve[i] = Math.sign(x) * (CEILING_KNEE + span * Math.tanh((abs - CEILING_KNEE) / span));
      }
    }
  }
  return ceilingCurve;
}

class ThockAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.85;
  private muted = false;
  private broken = false;
  private clockCheck = 0;
  private pending: Array<() => void> = [];
  private deskDownTimes: number[] = [];
  private deskUpTimes: number[] = [];

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
        limiter.threshold.value = -4;
        limiter.knee.value = 3;
        limiter.ratio.value = 16;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.045;
        const ceilingDrive = ctx.createGain();
        ceilingDrive.gain.value = 1 / CEILING_RANGE;
        const ceiling = ctx.createWaveShaper();
        ceiling.curve = getTruePeakCeilingCurve();
        ceiling.oversample = 'none';
        master.connect(limiter);
        limiter.connect(ceilingDrive);
        ceilingDrive.connect(ceiling);
        ceiling.connect(ctx.destination);
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

  private deskVoiceScale(phase: 'down' | 'up', time: number): number {
    const history = phase === 'down' ? this.deskDownTimes : this.deskUpTimes;
    let keep = 0;
    for (let i = 0; i < history.length; i++) {
      if (time - history[i] <= DESK_OVERLAP_WINDOW && history[i] <= time + 0.02) {
        history[keep++] = history[i];
      }
    }
    history.length = keep;
    const scale = 1 / Math.sqrt(1 + 0.55 * keep);
    history.push(time);
    if (history.length > 16) history.shift();
    return scale;
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
    const buffer = deskSamples(build);
    let downTime: number | undefined;
    let cancelled = false;

    const play = (phase: 'down' | 'up') => {
      const ctx = this.ctx!;
      const master = this.masterGain!;
      const earliest = () => phase === 'down'
        ? ctx.currentTime
        : Math.max(ctx.currentTime, downTime! + 0.012);

      if (buffer) {
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        source.playbackRate.value = touch.rate;
        source.connect(gain);
        gain.connect(master);
        source.onended = () => gain.disconnect();
        const time = earliest();
        gain.gain.value = touch.gain * this.deskVoiceScale(phase, time);
        source.start(time, phase === 'down' ? 0 : DESK_PHASE_SECONDS, DESK_PHASE_SECONDS);
        return time;
      }

      // The first stroke after a build change can precede the offline render.
      // Use the same synthesis on the live graph so that stroke still starts immediately.
      const daily = getDailyVariant(build.dailyVariantId);
      const type = daily?.baseSwitch ?? build.switchType;
      const time = earliest();
      const voiceGain = touch.gain * this.deskVoiceScale(phase, time) * deskFallbackTrim(type, build.baseMaterial);
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
