import { ClickerBuild, getDailyVariant } from '../types/build';
import { getNoiseBuffer, playMilestoneChime, prepareSwitchStroke } from './recipes';

const SCHEDULE_AHEAD = 0.024;
const MIN_STROKE_GAP = 0.045;

class ThockAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 0.85;
  private muted = false;
  private broken = false;
  private clockCheck = 0;
  private pending: Array<() => void> = [];

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
        master.connect(limiter);
        limiter.connect(ctx.destination);
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

  public triggerMilestone(milestone: number): void {
    this.whenReady(() => {
      const ctx = this.ctx!;
      playMilestoneChime(ctx, this.masterGain!, milestone, ctx.currentTime + SCHEDULE_AHEAD);
    });
  }
}

export const audioEngine = new ThockAudioEngine();
