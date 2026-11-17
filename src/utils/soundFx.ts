class SoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType = 'sine', gainVal = 0.08, delay = 0) {
    const ctx = this.getContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + delay;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(gainVal, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  playCard() {
    this.tone(420, 0.09, 'triangle', 0.09);
    this.tone(620, 0.08, 'sine', 0.06, 0.03);
  }

  drawCard() {
    this.tone(280, 0.08, 'sine', 0.07);
  }

  unoCall() {
    this.tone(587.33, 0.12, 'triangle', 0.11, 0);
    this.tone(880, 0.22, 'triangle', 0.12, 0.1);
  }

  skip() {
    this.tone(360, 0.1, 'sawtooth', 0.05, 0);
    this.tone(220, 0.14, 'sawtooth', 0.05, 0.08);
  }

  reverse() {
    this.tone(392, 0.08, 'triangle', 0.08, 0);
    this.tone(523.25, 0.08, 'triangle', 0.08, 0.06);
    this.tone(392, 0.09, 'triangle', 0.07, 0.12);
  }

  penalty() {
    this.tone(220, 0.14, 'sawtooth', 0.06, 0);
    this.tone(175, 0.2, 'sawtooth', 0.06, 0.11);
  }

  flipSide() {
    this.tone(330, 0.12, 'sine', 0.09, 0);
    this.tone(495, 0.14, 'sine', 0.09, 0.08);
    this.tone(660, 0.18, 'triangle', 0.1, 0.16);
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.tone(n, 0.22, 'triangle', 0.11, idx * 0.11);
    });
  }
}

export const soundFx = new SoundEngine();
