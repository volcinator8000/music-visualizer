/* ============================================================
   voices.js — the instrument library.
   Every instrument is either an additive harmonic profile turned into a
   PeriodicWave, or a Karplus-Strong string rendered into an AudioBuffer.
   Shared by the Instruments, Notes & Chords, Amp and Pedals views.
   ============================================================ */
(function (global) {
  'use strict';

  var INSTRUMENTS = {
    acoustic: {
      name: 'Acoustic Guitar', kind: 'pluck', color: '#ffb347',
      damping: 0.996, blend: 0.5, dur: 3.4, tone: 4200,
      body: [{ f: 100, q: 1.2, g: 6 }, { f: 220, q: 2, g: 4 }],
      sustain: false, range: [40, 76],
      desc: 'Plucked string (Karplus–Strong). Broadband pick noise decays into a nearly harmonic series; high partials die first, which is why a guitar goes dull as the note rings out.'
    },
    electric: {
      name: 'Electric Guitar', kind: 'pluck', color: '#ff8c1a',
      damping: 0.9975, blend: 0.82, dur: 4.0, tone: 3000,
      body: [{ f: 800, q: 1.4, g: 5 }], drive: 0.12,
      sustain: false, range: [40, 84],
      desc: 'Magnetic pickup: narrower band, longer sustain, slight compression from the amp front end. Fewer very high partials than the acoustic — the pickup is a lowpass all by itself.'
    },
    bass: {
      name: 'Bass Guitar', kind: 'pluck', color: '#a78bfa',
      damping: 0.9985, blend: 0.35, dur: 3.2, tone: 1400,
      body: [{ f: 60, q: 1.1, g: 8 }],
      sustain: false, range: [28, 60],
      desc: 'Same string model an octave down. Nearly all the energy sits under 500 Hz; what you hear as "definition" is the 2nd–5th harmonic, not the fundamental.'
    },
    piano: {
      name: 'Piano', kind: 'harm', color: '#e7ecf5',
      harmonics: [1, 0.62, 0.38, 0.26, 0.15, 0.10, 0.07, 0.05, 0.03, 0.02],
      adsr: { a: 0.004, d: 1.9, s: 0.06, r: 0.5 }, detune: 4, tone: 6000,
      sustain: false, range: [36, 88],
      desc: 'Hammer strike: instant attack, long exponential decay, strong odd + even harmonics. Three slightly detuned strings per note produce the characteristic shimmer.'
    },
    violin: {
      name: 'Violin', kind: 'harm', color: '#3ddbd9',
      harmonics: [1, 0.78, 0.62, 0.5, 0.42, 0.33, 0.27, 0.2, 0.16, 0.12, 0.09, 0.07],
      adsr: { a: 0.09, d: 0.25, s: 0.75, r: 0.25 },
      vibrato: { rate: 5.4, depth: 14 }, tone: 9000,
      sustain: true, range: [55, 91],
      desc: 'Bowed string: a sawtooth-like stack of harmonics falling roughly as 1/n, sustained as long as the bow moves, with ~5–6 Hz vibrato modulating the pitch.'
    },
    flute: {
      name: 'Flute', kind: 'harm', color: '#7bd88f',
      harmonics: [1, 0.28, 0.10, 0.05, 0.02],
      adsr: { a: 0.07, d: 0.15, s: 0.85, r: 0.16 },
      vibrato: { rate: 4.8, depth: 8 }, breath: 0.05, tone: 7000,
      sustain: true, range: [60, 96],
      desc: 'Almost a pure sine: the 2nd harmonic is 11 dB down and there is very little above it. The "air" you hear is broadband breath noise, not harmonic content.'
    },
    trumpet: {
      name: 'Trumpet', kind: 'harm', color: '#ff6b9d',
      harmonics: [0.7, 1, 0.9, 0.75, 0.6, 0.5, 0.42, 0.3, 0.22, 0.15, 0.1],
      adsr: { a: 0.045, d: 0.1, s: 0.85, r: 0.14 },
      vibrato: { rate: 5.6, depth: 6 }, tone: 11000,
      sustain: true, range: [54, 84],
      desc: 'Brass formant: the 2nd and 3rd harmonics are *louder than the fundamental*, and the whole spectrum brightens as you blow harder. That rising energy is what cuts through a mix.'
    },
    organ: {
      name: 'Organ', kind: 'harm', color: '#ffd166',
      harmonics: [1, 0.85, 0.55, 0.6, 0, 0.35, 0, 0.28, 0, 0, 0, 0.18],
      adsr: { a: 0.012, d: 0.02, s: 1, r: 0.08 }, tone: 12000,
      sustain: true, range: [36, 88],
      desc: 'Drawbars: discrete pipes at octave and fifth ratios (1, 2, 3, 4, 6, 8, 12 ×). No decay at all — a perfectly flat sustain, which is why an organ note looks like a repeating static waveform.'
    },
    sine: {
      name: 'Sine', kind: 'harm', color: '#8ab4ff', harmonics: [1],
      adsr: { a: 0.01, d: 0.02, s: 1, r: 0.1 }, sustain: true, range: [36, 96],
      desc: 'A single frequency, no harmonics at all. The reference case: one spike in the spectrum, one smooth curve in time.'
    },
    saw: {
      name: 'Sawtooth', kind: 'harm', color: '#c084fc',
      harmonics: (function () { var h = []; for (var n = 1; n <= 24; n++) h.push(1 / n); return h; })(),
      adsr: { a: 0.008, d: 0.05, s: 0.9, r: 0.1 }, sustain: true, range: [36, 96],
      desc: 'Every harmonic present at amplitude 1/n. Buzzy and bright — the classic subtractive-synth starting point because there is so much for a filter to remove.'
    },
    square: {
      name: 'Square', kind: 'harm', color: '#5eead4',
      harmonics: (function () { var h = []; for (var n = 1; n <= 24; n++) h.push(n % 2 ? 1 / n : 0); return h; })(),
      adsr: { a: 0.008, d: 0.05, s: 0.9, r: 0.1 }, sustain: true, range: [36, 96],
      desc: 'Odd harmonics only, at 1/n. Hollow and clarinet-like: killing the even harmonics removes the octave, so the timbre sits "between" octaves.'
    }
  };

  var pluckCache = {};

  function getPluck(ctx, def, freq, key) {
    var id = key + '|' + Math.round(freq * 4);
    if (pluckCache[id]) return pluckCache[id];
    var b = DSP.pluckBuffer(ctx, freq, def.dur, def.damping, def.blend);
    pluckCache[id] = b;
    return b;
  }

  var waveCache = {};
  function getWave(ctx, key, def) {
    if (waveCache[key]) return waveCache[key];
    waveCache[key] = DSP.waveFromHarmonics(ctx, def.harmonics);
    return waveCache[key];
  }

  /* Play one note into `dest`. Returns a handle with .release() / .stop(). */
  function play(dest, key, freq, opts) {
    opts = opts || {};
    var ctx = Engine.ctx;
    if (!ctx) return null;
    var def = INSTRUMENTS[key] || INSTRUMENTS.sine;
    var t0 = opts.when || ctx.currentTime;
    var vel = opts.velocity === undefined ? 0.8 : opts.velocity;
    var out = ctx.createGain();
    out.gain.value = 1;
    var nodes = [out];

    // tone / body shaping shared by both synthesis kinds
    var tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(def.tone || 8000, ctx.sampleRate / 2 - 1000);
    tone.Q.value = 0.6;
    tone.connect(out);
    nodes.push(tone);

    var input = tone;
    if (def.body) {
      def.body.forEach(function (b) {
        var f = ctx.createBiquadFilter();
        f.type = 'peaking'; f.frequency.value = b.f; f.Q.value = b.q; f.gain.value = b.g;
        f.connect(input); input = f; nodes.push(f);
      });
    }
    if (def.drive) {
      var ws = ctx.createWaveShaper();
      ws.curve = DSP.shaperCurve('soft', def.drive);
      ws.oversample = '2x';
      ws.connect(input); input = ws; nodes.push(ws);
    }

    var env = ctx.createGain();
    env.connect(input);
    nodes.push(env);
    out.connect(dest);

    var sources = [], handle;

    if (def.kind === 'pluck') {
      var src = ctx.createBufferSource();
      src.buffer = getPluck(ctx, def, freq, key);
      src.connect(env);
      env.gain.setValueAtTime(vel, t0);
      src.start(t0);
      sources.push(src);
      handle = {
        release: function (when) {
          var t = when || ctx.currentTime;
          env.gain.cancelScheduledValues(t);
          env.gain.setTargetAtTime(0.0001, t, 0.12);
          try { src.stop(t + 0.6); } catch (e) {}
        }
      };
    } else {
      var a = def.adsr, voices = def.detune ? 3 : 1;
      var wave = getWave(ctx, key, def);
      for (var v = 0; v < voices; v++) {
        var o = ctx.createOscillator();
        o.setPeriodicWave(wave);
        o.frequency.value = freq;
        if (def.detune) o.detune.value = (v - 1) * def.detune;
        if (def.vibrato) {
          var lfo = ctx.createOscillator(), lg = ctx.createGain();
          lfo.frequency.value = def.vibrato.rate + v * 0.13;
          lg.gain.value = 0;
          // fade the vibrato in — instant vibrato sounds synthetic
          lg.gain.setValueAtTime(0, t0);
          lg.gain.linearRampToValueAtTime(def.vibrato.depth, t0 + 0.35);
          lfo.connect(lg); lg.connect(o.detune);
          lfo.start(t0); sources.push(lfo);
        }
        o.connect(env);
        o.start(t0);
        sources.push(o);
      }
      if (def.breath) {
        var nb = ctx.createBufferSource();
        nb.buffer = DSP.noiseBuffer(ctx, 2); nb.loop = true;
        var nf = ctx.createBiquadFilter();
        nf.type = 'bandpass'; nf.frequency.value = freq * 2.2; nf.Q.value = 1.4;
        var ng = ctx.createGain(); ng.gain.value = def.breath * vel;
        nb.connect(nf); nf.connect(ng); ng.connect(env);
        nb.start(t0); sources.push(nb);
      }
      var peak = vel / Math.sqrt(voices);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(peak, t0 + a.a);
      env.gain.setTargetAtTime(peak * a.s, t0 + a.a, Math.max(0.01, a.d / 3));
      handle = {
        release: function (when) {
          var t = Math.max(when || ctx.currentTime, t0 + 0.02);
          env.gain.cancelScheduledValues(t);
          env.gain.setValueAtTime(env.gain.value, t);
          env.gain.setTargetAtTime(0.0001, t, Math.max(0.02, a.r / 3));
          sources.forEach(function (s) { try { s.stop(t + a.r + 0.4); } catch (e) {} });
        }
      };
    }

    handle.freq = freq;
    handle.def = def;
    handle.out = out;
    handle.stop = handle.release;
    if (opts.duration) handle.release(t0 + opts.duration);
    // decaying keyboard instruments (piano) fade out on their own — without
    // this, their 6% sustain tail would drone forever and leak oscillators
    else if (def.kind !== 'pluck' && !def.sustain) {
      var ad = def.adsr;
      handle.release(t0 + ad.a + ad.d * 2.2);
    }
    return handle;
  }

  global.Voices = { defs: INSTRUMENTS, play: play, keys: Object.keys(INSTRUMENTS) };
})(window);
