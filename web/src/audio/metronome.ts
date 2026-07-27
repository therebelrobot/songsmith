/**
 * Lookahead scheduler over the raw Web Audio API. setInterval alone drifts
 * audibly; scheduling against AudioContext.currentTime doesn't. Ticks at
 * sixteenth-note resolution (matching the grid's offset unit) so playback
 * highlighting can track syllables between beats, but only sounds a click on
 * the beat, accented on the downbeat.
 */

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;
const SIXTEENTHS_PER_BEAT = 4;

export interface MetronomeOptions {
  bpm: number;
  beatsPerBar: number;
  /** fires once per sixteenth note, scheduled to land close to real playback time */
  onTick?: (bar: number, beat: number) => void;
}

export class Metronome {
  private opts: MetronomeOptions;
  private ctx: AudioContext | null = null;
  private timer: number | null = null;
  private nextTickTime = 0;
  private tickIndex = 0;
  private startBar = 1;

  constructor(opts: MetronomeOptions) {
    this.opts = opts;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  setBpm(bpm: number): void {
    this.opts.bpm = bpm;
  }

  start(fromBar = 1): void {
    this.stop();
    this.ctx = new AudioContext();
    this.startBar = fromBar;
    this.tickIndex = 0;
    this.nextTickTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      void ctx.close();
    }
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextTickTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      this.fireTick(this.nextTickTime, this.tickIndex);
      this.nextTickTime += 60 / this.opts.bpm / SIXTEENTHS_PER_BEAT;
      this.tickIndex += 1;
    }
  }

  private fireTick(time: number, tickIndex: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sixteenthsPerBar = this.opts.beatsPerBar * SIXTEENTHS_PER_BEAT;
    const tickInBar = tickIndex % sixteenthsPerBar;
    const bar = this.startBar + Math.floor(tickIndex / sixteenthsPerBar);
    const beat = 1 + tickInBar / SIXTEENTHS_PER_BEAT;

    if (tickInBar % SIXTEENTHS_PER_BEAT === 0) {
      const accent = tickInBar === 0;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = accent ? 1500 : 900;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, time + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
    }

    if (this.opts.onTick) {
      const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
      window.setTimeout(() => this.opts.onTick?.(bar, beat), delayMs);
    }
  }
}
