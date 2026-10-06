'use strict';
// Run with: node test/core.test.js
const assert = require('assert');
const C = require('../tuner-core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   - ' + name); }
  catch (e) { console.error('FAIL - ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// Synthetic instrument-like tone: fundamental plus harmonics.
function tone(freq, sampleRate, n, harmonics, noise) {
  const buf = new Float32Array(n);
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) {
      v += harmonics[h] * Math.sin(2 * Math.PI * freq * (h + 1) * i / sampleRate + h);
    }
    buf[i] = v * 0.25 + (noise ? rand() * noise : 0);
  }
  return buf;
}

const centsErr = (a, b) => Math.abs(1200 * Math.log2(a / b));
const RATES = [44100, 48000];
const N = 4096;

test('note math: A4 and middle C', () => {
  const a = C.freqToNote(440, 440);
  assert.strictEqual(a.name, 'A'); assert.strictEqual(a.octave, 4); assert.ok(Math.abs(a.cents) < 1e-9);
  const c = C.freqToNote(261.6256, 440);
  assert.strictEqual(c.name, 'C'); assert.strictEqual(c.octave, 4);
});

test('note math: cents offset and alternate reference pitch', () => {
  const sharp = C.freqToNote(440 * Math.pow(2, 20 / 1200), 440);
  assert.ok(Math.abs(sharp.cents - 20) < 1e-6);
  const r432 = C.freqToNote(432, 432);
  assert.strictEqual(r432.name, 'A'); assert.ok(Math.abs(r432.cents) < 1e-9);
  assert.ok(Math.abs(C.midiToFreq(69, 432) - 432) < 1e-9);
});

test('open string notes: guitar and ukulele', () => {
  const names = (m) => C.INSTRUMENTS[m].strings.map((x) => { const p = C.midiToParts(x); return p.name + p.octave; });
  assert.deepStrictEqual(names('guitar'), ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  assert.deepStrictEqual(names('ukulele'), ['G4', 'C4', 'E4', 'A4']);
  assert.ok(Math.abs(C.midiToFreq(40, 440) - 82.4069) < 0.001);
});

test('nearestString picks the closest open string', () => {
  const g = C.INSTRUMENTS.guitar.strings;
  assert.strictEqual(C.nearestString(82.41, g, 440).index, 0);
  assert.strictEqual(C.nearestString(112, g, 440).index, 1);   // a bit sharp of A2
  assert.strictEqual(C.nearestString(325, g, 440).index, 5);   // a bit flat of E4
  const u = C.INSTRUMENTS.ukulele.strings;
  assert.strictEqual(C.nearestString(392, u, 440).index, 0);   // G4
  assert.strictEqual(C.nearestString(261.6, u, 440).index, 1); // C4
});

test('detects every guitar and ukulele string within 2 cents (rich harmonics)', () => {
  const all = C.INSTRUMENTS.guitar.strings.concat(C.INSTRUMENTS.ukulele.strings);
  RATES.forEach((sr) => all.forEach((midi) => {
    const f = C.midiToFreq(midi, 440);
    const r = C.detectPitch(tone(f, sr, N, [1, 0.6, 0.4, 0.25, 0.15]), sr);
    assert.ok(r, 'no pitch for ' + f.toFixed(2) + ' Hz @ ' + sr);
    assert.ok(centsErr(r.freq, f) < 2, f.toFixed(2) + ' Hz @ ' + sr + ' read ' + r.freq.toFixed(2));
  }));
});

test('low strings with a weak fundamental do not jump an octave', () => {
  RATES.forEach((sr) => [40, 45, 50].forEach((midi) => {
    const f = C.midiToFreq(midi, 440);
    const r = C.detectPitch(tone(f, sr, N, [0.35, 1, 0.8, 0.5, 0.3]), sr);
    assert.ok(r, 'no pitch for ' + f.toFixed(2));
    assert.ok(centsErr(r.freq, f) < 3, f.toFixed(2) + ' Hz @ ' + sr + ' read ' + r.freq.toFixed(2));
  }));
});

test('tracks small detuning (+/-10 cents) accurately', () => {
  [-10, 10].forEach((c) => {
    const f = 110 * Math.pow(2, c / 1200);
    const r = C.detectPitch(tone(f, 48000, N, [1, 0.5, 0.3]), 48000);
    assert.ok(r && Math.abs(1200 * Math.log2(r.freq / 110) - c) < 2, 'detune ' + c);
  });
});

test('still works with background noise', () => {
  const f = 196;
  const r = C.detectPitch(tone(f, 48000, N, [1, 0.5, 0.3], 0.08), 48000);
  assert.ok(r && centsErr(r.freq, f) < 4);
});

test('silence and quiet noise give no pitch', () => {
  assert.strictEqual(C.detectPitch(new Float32Array(N), 48000), null);
  const quiet = new Float32Array(N);
  for (let i = 0; i < N; i++) quiet[i] = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.002;
  assert.strictEqual(C.detectPitch(quiet, 48000), null);
});

test('loud random noise does not report a confident pitch', () => {
  const noise = new Float32Array(N);
  let s = 99;
  for (let i = 0; i < N; i++) { s = (s * 1664525 + 1013904223) >>> 0; noise[i] = (s / 4294967296 - 0.5) * 0.6; }
  assert.strictEqual(C.detectPitch(noise, 48000), null);
});

test('median helper', () => {
  assert.strictEqual(C.median([3, 1, 2]), 2);
  assert.strictEqual(C.median([4, 1, 3, 2]), 2.5);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some failed' : ''));
