import test from 'node:test';
import assert from 'node:assert/strict';
import { GardenAudio } from '../src/audio.js';

const param = () => ({ value: 0, setValueAtTime(value) { this.value = value; },
  linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
class Context {
  state = 'running'; currentTime = 0; destination = {}; notes = [];
  createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
  createDynamicsCompressor() {
    return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, disconnect() {} };
  }
  createOscillator() {
    const note = { frequency: param(), connect() {}, disconnect() { this.disconnected = true; },
      start() { this.started = true; }, stop() { this.stopped = true; } };
    this.notes.push(note); return note;
  }
  async close() { this.state = 'closed'; }
}

test('muting or disposing while resume is pending cannot play stale cues', async () => {
  for (const action of ['stop', 'close']) {
    const audio = new GardenAudio(Context);
    audio.context.state = 'suspended';
    let resume;
    audio.context.resume = () => new Promise(resolve => { resume = resolve; });
    const cue = audio.play('clear', 5);
    await audio[action]();
    resume(); await cue;
    assert.equal(audio.context.notes.length, 0);
  }
});

test('rapid cascades bound voices; mute stops every scheduled cue; volume zero stays silent', async () => {
  const audio = new GardenAudio(Context);
  for (let i = 0; i < 30; i++) await audio.play('clear', 5);
  assert(audio.voices.size > 1 && audio.voices.size <= 24);
  const count = audio.context.notes.length;
  audio.setVolume(0);
  assert.equal(audio.voices.size, 0);
  assert(audio.context.notes.every(note => note.stopped && note.disconnected));
  await audio.play();
  assert.equal(audio.context.notes.length, count);
  audio.setVolume(35);
  assert.equal(audio.master.gain.value, 0.35);
  await audio.play('swap');
  assert.equal(audio.voices.size, 1);
  await audio.close();
  assert.equal(audio.voices.size, 0);
  assert.equal(audio.context.state, 'closed');
});
