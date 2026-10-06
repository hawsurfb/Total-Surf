'use strict';
// Run with: node test/ui.smoke.test.js
// Runs index.html's real inline script against a tiny fake browser and a synthetic microphone.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = process.argv[2] || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const Core = require(path.join(root, 'tuner-core.js'));

class El {
  constructor(id) {
    this.id = id; this.children = []; this.style = {}; this.attrs = {}; this.listeners = {};
    this.hidden = false; this.className = ''; this._text = '';
    const self = this;
    this.classList = {
      toggle(c, on) {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        (on === undefined ? !set.has(c) : on) ? set.add(c) : set.delete(c);
        self.className = [...set].join(' ');
      }
    };
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent ?? c.text ?? '').join(''); }
  set textContent(v) { this._text = v; this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  focus() {}
  click() { (this.listeners.click || []).forEach((f) => f({})); }
}

const els = {};
const byId = (id) => (els[id] = els[id] || new El(id));
const modeBtns = ['guitar', 'ukulele', 'chromatic'].map((m) => { const b = new El(); b.setAttribute('data-mode', m); return b; });
const themeBtns = ['default', 'tuna'].map((t) => { const b = new El(); b.setAttribute('data-theme-choice', t); return b; });
const words = [new El()];
const themeMeta = new El();
const docEl = new El();
const docListeners = {};
const document = {
  title: '', hidden: false, documentElement: docEl,
  getElementById: byId,
  createElement: () => new El(),
  createTextNode: (t) => ({ text: t, textContent: t }),
  querySelectorAll(sel) {
    if (sel === '#modes button') return modeBtns;
    if (sel === '#themes button') return themeBtns;
    if (sel === '.word') return words;
    return [];
  },
  querySelector: () => themeMeta,
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); }
};

let clock = 0;
let currentFreq = null;
let phase = 0;
const rafQueue = [];

class FakeAnalyser {
  set fftSize(v) { this._n = v; }
  get fftSize() { return this._n; }
  getFloatTimeDomainData(buf) {
    for (let i = 0; i < buf.length; i++) {
      buf[i] = currentFreq ? 0.25 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase)) : 0;
      if (currentFreq) phase += 2 * Math.PI * currentFreq / 48000;
    }
  }
}
class FakeAudioContext {
  constructor() { this.sampleRate = 48000; this.state = 'running'; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() { return new FakeAnalyser(); }
}

const sandbox = {
  document, TunerCore: Core, console,
  isSecureContext: true,
  AudioContext: FakeAudioContext,
  navigator: {
    mediaDevices: { getUserMedia: () => Promise.resolve({ getAudioTracks: () => [{ addEventListener() {} }], getTracks: () => [{ stop() {} }] }) },
    wakeLock: { request: () => Promise.resolve({ addEventListener() {}, release: () => Promise.resolve() }) }
  },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } },
  getComputedStyle: () => ({ getPropertyValue: () => '#0e1116' }),
  location: { protocol: 'https:' },
  performance: { now: () => clock },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => { rafQueue.length = 0; },
  Math, Array, Number, String, Promise, Set, Float32Array, Uint8Array, parseInt, setTimeout
};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(script, sandbox);

const flush = () => new Promise((r) => setImmediate(r));
function run(ms) {                       // advance the fake clock, running animation frames
  const end = clock + ms;
  while (clock < end) {
    clock += 20;
    const cb = rafQueue.shift();
    if (cb) cb(clock);
  }
}
const note = () => byId('note').textContent;
const hint = () => byId('hint').textContent;
let n = 0;
const step = (name, fn) => { fn(); n++; console.log('ok   - ' + name); };

(async () => {
  step('loads: default theme, guitar mode, 6 string buttons', () => {
    assert.strictEqual(docEl.getAttribute('data-theme'), 'default');
    assert.strictEqual(byId('strings').children.length, 6);
    assert.strictEqual(byId('a4Val').textContent, 'A = 440 Hz');
  });

  byId('go').click();
  await flush(); await flush();
  step('tapping Tune shows the tuner screen', () => {
    assert.strictEqual(byId('start').hidden, true);
    assert.strictEqual(byId('tuner').hidden, false);
    assert.strictEqual(note(), '—');
  });

  step('plays low E (82.41 Hz): shows E2, in tune, string 1 lit', () => {
    currentFreq = 82.4069; run(600);
    assert.strictEqual(note(), 'E2');
    assert.strictEqual(hint(), 'In tune');
    assert.ok(byId('strings').children[0].className.includes('good'));
    assert.ok(Math.abs(parseFloat(byId('needle').style.left) - 50) < 1, 'needle near centre');
  });

  step('sharp of E2 (85 Hz): says Tune down, needle right of centre', () => {
    currentFreq = 85; run(1000);
    assert.strictEqual(hint(), 'Tune down');
    assert.ok(parseFloat(byId('needle').style.left) > 50);
    assert.ok(byId('centsTxt').textContent.startsWith('+'));
  });

  step('flat of A2 (108 Hz): switches to A string, says Tune up', () => {
    currentFreq = 108; run(1500);
    assert.strictEqual(note(), 'A2');
    assert.strictEqual(hint(), 'Tune up');
    assert.ok(byId('strings').children[1].className.includes('active'));
  });

  step('tapping a string locks it, tapping again unlocks', () => {
    byId('strings').children[1].click();
    assert.strictEqual(byId('strings').children[1].getAttribute('aria-pressed'), 'true');
    byId('strings').children[1].click();
    assert.strictEqual(byId('strings').children[1].getAttribute('aria-pressed'), 'false');
  });

  step('silence returns to idle', () => {
    currentFreq = null; run(1200);
    assert.strictEqual(note(), '—');
    assert.strictEqual(hint(), 'Play a string');
    assert.ok(byId('needle').className.includes('idle'));
  });

  step('ukulele mode: 4 strings, A4 (440 Hz) reads A4', () => {
    modeBtns[1].click();
    assert.strictEqual(byId('strings').children.length, 4);
    currentFreq = 440; run(800);
    assert.strictEqual(note(), 'A4');
    assert.strictEqual(hint(), 'In tune');
  });

  step('chromatic mode: hides strings, 261.63 Hz reads C4', () => {
    currentFreq = null; run(1000);
    modeBtns[2].click();
    assert.strictEqual(byId('strings').hidden, true);
    currentFreq = 261.63; run(800);
    assert.strictEqual(note(), 'C4');
  });

  step('chromatic: 466.16 Hz shows B♭ as A♯4', () => {
    currentFreq = null; run(1000);
    currentFreq = 466.16; run(800);
    assert.strictEqual(note(), 'A♯4');
  });

  step('Tuna theme: swaps the word and title', () => {
    themeBtns[1].click();
    assert.strictEqual(docEl.getAttribute('data-theme'), 'tuna');
    assert.strictEqual(words[0].textContent, 'Tuna');
    assert.strictEqual(document.title, 'No Kapu Tuna');
    themeBtns[0].click();
    assert.strictEqual(words[0].textContent, 'Tuner');
  });

  step('reference pitch stepper changes and persists', () => {
    byId('a4Up').click();
    assert.strictEqual(byId('a4Val').textContent, 'A = 441 Hz');
    assert.strictEqual(sandbox.localStorage._d['nokapu.a4'], '441');
    byId('a4Down').click(); byId('a4Down').click();
    assert.strictEqual(byId('a4Val').textContent, 'A = 439 Hz');
  });

  step('settings sheet opens and closes', () => {
    byId('openSettings').click();
    assert.strictEqual(byId('sheet').hidden, false);
    byId('closeSheet').click();
    assert.strictEqual(byId('sheet').hidden, true);
  });

  console.log('\n' + n + ' UI checks passed');
})().catch((e) => { console.error('FAIL - ' + e.message); console.error(e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); });
