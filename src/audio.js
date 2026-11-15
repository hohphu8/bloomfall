// Short synthesized cues: no assets, timers or network requests. The owner
// cancels scheduled voices on mute, pause, hidden tabs and interrupted games.
export class GardenAudio {
  constructor(Context, volume = 65) {
    this.context = new Context();
    this.master = this.context.createGain();
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.08;
    this.master.connect(this.limiter);
    this.limiter.connect(this.context.destination);
    this.voices = new Set();
    this.generation = 0;
    this.closed = false;
    this.setVolume(volume);
  }
  setVolume(value) {
    this.volume = Math.max(0, Math.min(100, Number(value) || 0));
    this.master.gain.setValueAtTime(this.volume / 100, this.context.currentTime);
    if (!this.volume) this.stop();
  }
  stop() {
    this.generation++;
    for (const voice of this.voices) {
      voice.note.onended = null;
      try { voice.note.stop(); } catch { /* Already ended. */ }
      voice.note.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
  }
  async play(kind = 'clear', level = 1) {
    if (this.closed || !this.volume) return;
    const generation = this.generation;
    if (this.context.state === 'suspended') await this.context.resume();
    if (this.closed || generation !== this.generation || !this.volume) return;
    const now = this.context.currentTime;
    const tone = (frequency, delay, duration, peak, type = 'triangle', end = frequency) => {
      if (this.voices.size >= 24) return;
      const note = this.context.createOscillator(), gain = this.context.createGain();
      const voice = { note, gain }, start = now + delay;
      note.type = type;
      note.frequency.setValueAtTime(frequency, start);
      note.frequency.exponentialRampToValueAtTime(end, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      note.connect(gain);
      gain.connect(this.master);
      this.voices.add(voice);
      note.onended = () => {
        note.disconnect(); gain.disconnect(); this.voices.delete(voice);
      };
      note.start(start);
      note.stop(start + duration + 0.01);
    };
    if (kind === 'swap') {
      tone(280, 0, 0.07, 0.11, 'sine', 420);
    } else if (kind === 'invalid') {
      tone(260, 0, 0.12, 0.12, 'triangle', 150);
    } else if (kind === 'fall') {
      tone(180, 0, 0.07, 0.07, 'sine', 90);
    } else {
      const step = Math.max(1, Math.min(5, level));
      const base = [392, 440, 523.25, 659.25, 783.99][step - 1];
      tone(130, 0, 0.12, 0.19, 'sine', 55);
      for (let i = 0; i < Math.min(5, step + 2); i++)
        tone(base * [1, 1.25, 1.5, 2, 2.5][i], i * 0.028, 0.16, 0.13);
    }
  }
  async close() {
    this.closed = true;
    this.stop();
    this.master.disconnect();
    this.limiter.disconnect();
    await this.context.close();
  }
}
