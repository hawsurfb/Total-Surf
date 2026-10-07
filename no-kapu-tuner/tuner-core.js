/*
 * No Kapu Tuner — core logic (pitch detection + note math).
 * Plain JS, no dependencies. Works in the browser (global `TunerCore`)
 * and in Node (`require('./tuner-core.js')`) so it can be tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TunerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  var NOTE_NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

  // Guitar tunings as MIDI numbers, low string to high.
  var TUNINGS = {
    standard: { label: 'Standard', hint: 'E A D G B E', strings: [40, 45, 50, 55, 59, 64] },
    dropd:    { label: 'Drop D', hint: 'D A D G B E', strings: [38, 45, 50, 55, 59, 64] },
    halfdown: { label: 'Half step down', hint: 'E♭ A♭ D♭ G♭ B♭ E♭', strings: [39, 44, 49, 54, 58, 63] },
    fulldown: { label: 'Full step down', hint: 'D G C F A D', strings: [38, 43, 48, 53, 57, 62] },
    dadgad:   { label: 'DADGAD', hint: 'D A D G A D', strings: [38, 45, 50, 55, 57, 62] },
    openg:    { label: 'Open G', hint: 'D G D G B D', strings: [38, 43, 50, 55, 59, 62] }
  };

  // Open strings as MIDI note numbers, in the order they are displayed.
  var INSTRUMENTS = {
    guitar: { label: 'Guitar', strings: [40, 45, 50, 55, 59, 64] }, // E2 A2 D3 G3 B3 E4
    ukulele: { label: 'Ukulele', strings: [67, 60, 64, 69] },       // G4 C4 E4 A4 (re-entrant GCEA)
    chromatic: { label: 'Chromatic', strings: null }
  };

  function midiToFreq(midi, a4) {
    return (a4 || 440) * Math.pow(2, (midi - 69) / 12);
  }

  // flats: spell black keys as D♭ instead of C♯.
  function midiToParts(midi, flats) {
    var idx = ((midi % 12) + 12) % 12;
    return { name: (flats ? NOTE_NAMES_FLAT : NOTE_NAMES)[idx], octave: Math.floor(midi / 12) - 1 };
  }

  // Nearest equal-tempered note for a frequency, with cents offset (-50..+50).
  function freqToNote(freq, a4) {
    a4 = a4 || 440;
    var midiFloat = 69 + 12 * Math.log(freq / a4) / Math.LN2;
    var midi = Math.round(midiFloat);
    var parts = midiToParts(midi);
    return {
      midi: midi,
      name: parts.name,
      octave: parts.octave,
      cents: (midiFloat - midi) * 100,
      targetFreq: midiToFreq(midi, a4)
    };
  }

  function centsBetween(freq, targetFreq) {
    return 1200 * Math.log(freq / targetFreq) / Math.LN2;
  }

  // Which open string is closest (in cents) to this frequency?
  function nearestString(freq, stringMidis, a4) {
    var best = -1, bestAbs = Infinity, bestCents = 0;
    for (var i = 0; i < stringMidis.length; i++) {
      var c = centsBetween(freq, midiToFreq(stringMidis[i], a4));
      if (Math.abs(c) < bestAbs) { bestAbs = Math.abs(c); best = i; bestCents = c; }
    }
    return { index: best, cents: bestCents };
  }

  function median(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /*
   * YIN pitch detector (de Cheveigné & Kawahara, 2002).
   * buf: Float32Array of time-domain samples, sampleRate: Hz.
   * Returns { freq, clarity, rms } or null when there is no clear pitch.
   */
  function detectPitch(buf, sampleRate, opts) {
    opts = opts || {};
    var minFreq = opts.minFreq || 60;
    var maxFreq = opts.maxFreq || 1400;
    var threshold = opts.threshold || 0.15;
    var fallback = opts.fallback || 0.3;
    var minRms = opts.minRms || 0.008;

    var n = buf.length;
    var half = n >> 1;

    var sumSq = 0;
    for (var i = 0; i < n; i++) sumSq += buf[i] * buf[i];
    var rms = Math.sqrt(sumSq / n);
    if (rms < minRms) return null;

    var maxTau = Math.min(half - 3, Math.floor(sampleRate / minFreq));
    var minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
    if (maxTau <= minTau + 2) return null;

    // Difference function, folded into the cumulative mean normalised form.
    var cm = new Float32Array(maxTau + 2);
    cm[0] = 1;
    var running = 0;
    for (var tau = 1; tau <= maxTau + 1; tau++) {
      var s = 0;
      for (var j = 0; j < half; j++) {
        var d = buf[j] - buf[j + tau];
        s += d * d;
      }
      running += s;
      cm[tau] = running === 0 ? 1 : (s * tau) / running;
    }

    // First dip below the threshold, followed down to its local minimum.
    var est = -1;
    for (var t = minTau; t <= maxTau; t++) {
      if (cm[t] < threshold) {
        while (t + 1 <= maxTau && cm[t + 1] < cm[t]) t++;
        est = t;
        break;
      }
    }
    if (est < 0) {
      var best = minTau;
      for (var u = minTau + 1; u <= maxTau; u++) if (cm[u] < cm[best]) best = u;
      if (cm[best] > fallback) return null;
      est = best;
    }

    // Parabolic interpolation for sub-sample accuracy.
    var better = est;
    if (est > 1 && est < maxTau + 1) {
      var s0 = cm[est - 1], s1 = cm[est], s2 = cm[est + 1];
      var denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) better = est + (s2 - s0) / denom;
    }

    return { freq: sampleRate / better, clarity: 1 - cm[est], rms: rms };
  }

  return {
    NOTE_NAMES: NOTE_NAMES,
    NOTE_NAMES_FLAT: NOTE_NAMES_FLAT,
    TUNINGS: TUNINGS,
    INSTRUMENTS: INSTRUMENTS,
    midiToFreq: midiToFreq,
    midiToParts: midiToParts,
    freqToNote: freqToNote,
    centsBetween: centsBetween,
    nearestString: nearestString,
    median: median,
    detectPitch: detectPitch
  };
});
