/* ============================================================
   engine.js — shared audio context, DSP helpers, canvas renderers
   No build step, no dependencies. Plain script (works on file://).
   ============================================================ */
(function (global) {
  'use strict';

  // ---------------------------------------------------------- note math
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
  function midiName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  function midiPitch(m) { return NAMES[((m % 12) + 12) % 12]; }
  function isBlack(m) { return [1, 3, 6, 8, 10].indexOf(((m % 12) + 12) % 12) >= 0; }

  // ---------------------------------------------------------- audio graph
  var Engine = {
    ctx: null,
    master: null,      // final gain before destination
    on: false,
    volume: 0.55,

    /* Create (or return) the AudioContext. Must be called from a user gesture
       or the browser keeps it suspended and the page is silent. */
    init: function () {
      if (this.ctx) return this.ctx;
      var AC = global.AudioContext || global.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;                 // ramped up by power()
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;
      this.master.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
      return this.ctx;
    },

    power: function (state) {
      this.init();
      this.on = state;
      if (state && this.ctx.state === 'suspended') this.ctx.resume();
      var g = this.master.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(g.value, 0.0001), t);
      g.linearRampToValueAtTime(state ? this.volume : 0.0001, t + 0.08);
      return this.on;
    },

    setVolume: function (v) {
      this.volume = v;
      if (this.ctx && this.on) {
        this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
      }
    },

    /* Guarantee the context is alive; returns true when audio can be heard. */
    ready: function () {
      if (!this.ctx) return false;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.on;
    },

    analyser: function (fftSize, smoothing) {
      var a = this.ctx.createAnalyser();
      a.fftSize = fftSize || 2048;
      a.smoothingTimeConstant = smoothing === undefined ? 0.72 : smoothing;
      a.minDecibels = -95;
      a.maxDecibels = -10;
      return a;
    },

    gain: function (v) { var g = this.ctx.createGain(); g.gain.value = v; return g; }
  };

  // ---------------------------------------------------------- DSP factories

  /* Waveshaper curves. `amt` 0..1. Each type has its own flavour of nonlinearity;
     the transfer curve is what the Pedals view plots. */
  function shaperCurve(type, amt, n) {
    n = n || 2048;
    var c = new Float32Array(n), i, x, k = Math.max(0.001, amt);
    for (i = 0; i < n; i++) {
      x = (i / (n - 1)) * 2 - 1;
      switch (type) {
        case 'soft':        // tube-ish asymmetric soft clip
          c[i] = Math.tanh(x * (1 + k * 14)) * (x > 0 ? 1 : 0.86);
          break;
        case 'hard':        // op-amp hard clip (distortion)
          var lim = 1 - k * 0.92;
          c[i] = Math.max(-lim, Math.min(lim, x * (1 + k * 22))) / (lim || 1);
          break;
        case 'fuzz':        // square-ish, gated, very asymmetric
          var d = Math.sign(x) * Math.pow(Math.abs(x), 1 / (1 + k * 6));
          c[i] = Math.tanh(d * (1 + k * 30)) * (x > 0 ? 1 : 0.7);
          break;
        case 'cheby':       // octave-up flavour: folds negative half
          c[i] = 2 * x * x - 1;
          c[i] = c[i] * (1 - k) + Math.tanh(x * (1 + k * 10)) * k;
          break;
        case 'fold':        // wavefolder
          c[i] = Math.sin(x * (1 + k * 9) * Math.PI * 0.5);
          break;
        default:            // clean
          c[i] = x;
      }
    }
    return c;
  }

  /* Synthesised impulse response: exponentially-decaying stereo noise.
     Avoids shipping an audio file, which GitHub Pages would happily serve
     but which we do not need. */
  function impulseResponse(ctx, seconds, decay, bright) {
    var rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate * seconds));
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), last = 0;
      for (var i = 0; i < len; i++) {
        var env = Math.pow(1 - i / len, decay);
        var white = Math.random() * 2 - 1;
        // one-pole lowpass darkens the tail (bright: 0 dark .. 1 bright)
        last = last + (white - last) * (0.08 + 0.9 * bright);
        d[i] = last * env;
      }
    }
    return buf;
  }

  /* Karplus-Strong plucked string, rendered offline into an AudioBuffer.
     ~15 lines of DSP that sound far more like a string than any oscillator. */
  function pluckBuffer(ctx, freq, seconds, damping, blend) {
    var rate = ctx.sampleRate;
    var N = Math.max(2, Math.round(rate / freq));
    var len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(1, len, rate);
    var out = buf.getChannelData(0);
    var ring = new Float32Array(N);
    for (var i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    // pre-filter the excitation: a pick near the bridge is brighter
    for (i = 1; i < N; i++) ring[i] = ring[i] * blend + ring[i - 1] * (1 - blend);
    var p = 0, prev = 0;
    for (i = 0; i < len; i++) {
      var cur = ring[p];
      out[i] = cur;
      var avg = (cur + prev) * 0.5 * damping;   // lowpass in the feedback loop
      prev = cur;
      ring[p] = avg;
      p = (p + 1) % N;
    }
    // gentle fade-out so the buffer never clicks at the end
    var fade = Math.min(len, Math.floor(rate * 0.05));
    for (i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
    return buf;
  }

  /* Build a PeriodicWave from a harmonic amplitude list — one oscillator
     then produces the full timbre, and the FFT view shows those partials. */
  function waveFromHarmonics(ctx, harmonics, phases) {
    var n = harmonics.length + 1;
    var real = new Float32Array(n), imag = new Float32Array(n);
    for (var i = 0; i < harmonics.length; i++) {
      var ph = phases ? phases[i] || 0 : 0;
      imag[i + 1] = harmonics[i] * Math.cos(ph);
      real[i + 1] = harmonics[i] * Math.sin(ph);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function noiseBuffer(ctx, seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var b = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // ---------------------------------------------------------- radix-2 FFT
  /* In-place iterative Cooley-Tukey. re/im are Float32Array of length 2^k.
     Used by Math Mode so the spectrum comes from *our* arithmetic, not from
     an AnalyserNode black box. */
  function fft(re, im) {
    var n = re.length, i, j, k;
    if (n <= 1) return;
    // bit reversal permutation
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var ar = re[i + k], ai = im[i + k];
          var br = re[i + k + len / 2], bi = im[i + k + len / 2];
          var xr = br * cr - bi * ci, xi = br * ci + bi * cr;
          re[i + k] = ar + xr; im[i + k] = ai + xi;
          re[i + k + len / 2] = ar - xr; im[i + k + len / 2] = ai - xi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  var WINDOWS = {
    rect: function () { return 1; },
    hann: function (i, N) { return 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1))); },
    hamming: function (i, N) { return 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1)); },
    blackman: function (i, N) {
      var a = 2 * Math.PI * i / (N - 1);
      return 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a);
    }
  };

  // ---------------------------------------------------------- canvas utils
  function fit(canvas, cssHeight) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || 600;
    var h = cssHeight || canvas.dataset.h || 180;
    h = parseInt(h, 10);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = h + 'px';
    }
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g: g, w: w, h: h };
  }

  function bg(g, w, h, rows, cols) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#080a0f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(58,66,86,.35)';
    g.lineWidth = 1;
    g.beginPath();
    var i;
    for (i = 1; i < (rows || 4); i++) {
      var y = Math.round(h * i / (rows || 4)) + .5;
      g.moveTo(0, y); g.lineTo(w, y);
    }
    for (i = 1; i < (cols || 8); i++) {
      var x = Math.round(w * i / (cols || 8)) + .5;
      g.moveTo(x, 0); g.lineTo(x, h);
    }
    g.stroke();
  }

  /* Oscilloscope with a zero-crossing trigger so the trace stops sliding. */
  function scope(canvas, analyser, color, opts) {
    opts = opts || {};
    var f = fit(canvas), g = f.g, w = f.w, h = f.h;
    if (!opts.overlay) bg(g, w, h, 4, 8);
    var n = analyser.fftSize;
    var buf = opts.buf || (analyser.__tbuf = analyser.__tbuf || new Float32Array(n));
    analyser.getFloatTimeDomainData(buf);

    // trigger: find a rising zero crossing in the first half
    var start = 0, half = n >> 1;
    for (var i = 1; i < half; i++) {
      if (buf[i - 1] <= 0 && buf[i] > 0) { start = i; break; }
    }
    var span = Math.min(n - start, opts.span || half);
    var yscale = (opts.gain || 1) * (h / 2) * 0.92;

    g.lineWidth = opts.thin ? 1.4 : 2;
    g.strokeStyle = color;
    g.beginPath();
    for (i = 0; i < span; i++) {
      var x = (i / (span - 1)) * w;
      var y = h / 2 - buf[start + i] * yscale;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    return buf;
  }

  /* Log-frequency magnitude spectrum. */
  function spectrum(canvas, analyser, color, opts) {
    opts = opts || {};
    var f = fit(canvas), g = f.g, w = f.w, h = f.h;
    var sr = Engine.ctx.sampleRate;
    var bins = analyser.frequencyBinCount;
    var data = analyser.__fbuf = analyser.__fbuf || new Uint8Array(bins);
    analyser.getByteFrequencyData(data);

    var fmin = opts.fmin || 20, fmax = Math.min(opts.fmax || 18000, sr / 2);
    var lmin = Math.log10(fmin), lmax = Math.log10(fmax);

    if (!opts.overlay) {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#080a0f';
      g.fillRect(0, 0, w, h);
      // decade gridlines + labels
      var marks = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
      g.strokeStyle = 'rgba(58,66,86,.4)';
      g.fillStyle = 'rgba(93,104,128,.9)';
      g.font = '9px ui-monospace,monospace';
      g.lineWidth = 1;
      marks.forEach(function (m) {
        if (m < fmin || m > fmax) return;
        var x = Math.round(w * (Math.log10(m) - lmin) / (lmax - lmin)) + .5;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 12); g.stroke();
        g.fillText(m >= 1000 ? (m / 1000) + 'k' : m, x + 3, h - 3);
      });
      for (var r = 1; r < 4; r++) {
        var y = Math.round(h * r / 4) + .5;
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
    }

    // Resample bins onto the log axis, keeping the peak in each pixel column.
    var cols = new Float32Array(Math.ceil(w));
    for (var b = 1; b < bins; b++) {
      var freq = b * sr / (bins * 2);
      if (freq < fmin || freq > fmax) continue;
      var px = Math.floor(w * (Math.log10(freq) - lmin) / (lmax - lmin));
      if (px < 0 || px >= cols.length) continue;
      var v = data[b] / 255;
      if (v > cols[px]) cols[px] = v;
    }
    // fill gaps left by sparse low-frequency bins
    for (var c = 1; c < cols.length; c++) if (cols[c] === 0) cols[c] = cols[c - 1] * 0.985;

    g.beginPath();
    g.moveTo(0, h);
    for (c = 0; c < cols.length; c++) g.lineTo(c, h - cols[c] * h * 0.94);
    g.lineTo(cols.length, h);
    g.closePath();
    if (!opts.lineOnly) {
      var grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, opts.fill0 || 'rgba(255,179,71,.05)');
      grad.addColorStop(1, opts.fill1 || 'rgba(255,179,71,.42)');
      g.fillStyle = grad;
      g.fill();
    }
    g.lineWidth = 1.6;
    g.strokeStyle = color;
    g.stroke();
    return { data: data, sr: sr, bins: bins };
  }

  /* Plot a filter/waveshaper transfer or response curve from a callback. */
  function plotCurve(canvas, pts, color, opts) {
    opts = opts || {};
    var f = fit(canvas), g = f.g, w = f.w, h = f.h;
    if (!opts.overlay) bg(g, w, h, opts.rows || 4, opts.cols || 8);
    g.lineWidth = 2;
    g.strokeStyle = color;
    g.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0] * w, y = (1 - pts[i][1]) * h;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  function label(canvas, text, align) {
    var f = fit(canvas), g = f.g;
    g.font = '700 10px ui-monospace,monospace';
    g.fillStyle = 'rgba(142,153,176,.85)';
    if (align === 'right') {
      g.textAlign = 'right'; g.fillText(text, f.w - 8, 14); g.textAlign = 'left';
    } else g.fillText(text, 8, 14);
  }

  // ---------------------------------------------------------- frame loop
  var Frame = (function () {
    var jobs = {}, active = null, running = false;
    function tick() {
      var list = jobs[active];
      if (list) for (var i = 0; i < list.length; i++) {
        try { list[i](); } catch (e) {
          if (!list[i].__errOnce) {          // report once, keep the loop alive
            list[i].__errOnce = true;
            console.error('frame job failed (' + active + '):', e);
          }
        }
      }
      requestAnimationFrame(tick);
    }
    return {
      add: function (view, fn) { (jobs[view] = jobs[view] || []).push(fn); },
      setActive: function (view) {
        active = view;
        if (!running) { running = true; requestAnimationFrame(tick); }
      },
      active: function () { return active; }
    };
  })();

  // ---------------------------------------------------------- small helpers
  function el(id) { return document.getElementById(id); }
  function slider(id, onChange, fmt) {
    var input = el(id), out = el(id + '-v');
    function update() {
      var v = parseFloat(input.value);
      if (out) out.textContent = fmt ? fmt(v) : v;
      if (onChange) onChange(v);
    }
    input.addEventListener('input', update);
    update();
    return { el: input, get: function () { return parseFloat(input.value); }, update: update };
  }
  function dbFmt(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + ' dB'; }
  function hzFmt(v) { return v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : v.toFixed(0) + ' Hz'; }
  function pctFmt(v) { return Math.round(v * 100) + '%'; }

  global.Engine = Engine;
  global.Viz = {
    fit: fit, bg: bg, scope: scope, spectrum: spectrum,
    plotCurve: plotCurve, label: label
  };
  global.DSP = {
    shaperCurve: shaperCurve, impulseResponse: impulseResponse,
    pluckBuffer: pluckBuffer, waveFromHarmonics: waveFromHarmonics,
    noiseBuffer: noiseBuffer, fft: fft, WINDOWS: WINDOWS
  };
  global.Music = {
    NAMES: NAMES, FLATS: FLATS, midiToFreq: midiToFreq, freqToMidi: freqToMidi,
    midiName: midiName, midiPitch: midiPitch, isBlack: isBlack
  };
  global.Frame = Frame;
  global.UI = { el: el, slider: slider, dbFmt: dbFmt, hzFmt: hzFmt, pctFmt: pctFmt };
})(window);
