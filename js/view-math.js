/* ============================================================
   view-math.js — the math sandbox.
   1. Sum arbitrary sinusoids sample-by-sample and run our own
      radix-2 FFT over the result (DSP.fft in engine.js).
   2. Two-source interference / active noise cancelling on a 2D plate.
   3. Sampling, aliasing and quantisation.
   All three panels are pure arithmetic — the audio graph is only
   used when you ask to *hear* a result.
   ============================================================ */
(function (global) {
  'use strict';

  var sub = 'sum';

  // ==================================================== 1 · SUM + FFT
  var partials = [];
  var pDirty = true;
  var cfg = { N: 2048, sr: 8000, noise: 0, win: 'hann', logy: true, logx: false };
  var playSrc = null;

  var COLORS = ['#ffb347', '#3ddbd9', '#a78bfa', '#ff6b9d', '#7bd88f', '#ffd166', '#8ab4ff', '#ff8c1a'];

  function addPartial(f, a, ph, on) {
    partials.push({ f: f, a: a, ph: ph || 0, on: on !== false });
    renderPartials();
  }

  function renderPartials() {
    var host = UI.el('sum-list');
    host.innerHTML = '<div class="prow-head"><span>#</span><span>freq Hz</span><span>amplitude</span><span>phase °</span><span></span></div>';
    partials.forEach(function (p, i) {
      var row = document.createElement('div');
      row.className = 'prow' + (p.on ? '' : ' off');
      row.innerHTML =
        '<div class="num" style="color:' + COLORS[i % COLORS.length] + '">' + (i + 1) + '</div>' +
        '<input type="number" value="' + p.f + '" min="1" max="12000" step="any">' +
        '<input type="range" min="0" max="1" step="0.01" value="' + p.a + '">' +
        '<input type="range" min="0" max="360" step="1" value="' + Math.round(p.ph * 180 / Math.PI) + '">' +
        '<button class="x" title="remove">✕</button>';
      var els = row.querySelectorAll('input,button,.num');
      els[0].addEventListener('click', function () { p.on = !p.on; row.classList.toggle('off', !p.on); pDirty = true; });
      els[1].addEventListener('input', function () { p.f = Math.max(0.1, +this.value || 1); pDirty = true; });
      els[2].addEventListener('input', function () { p.a = +this.value; pDirty = true; });
      els[3].addEventListener('input', function () { p.ph = +this.value * Math.PI / 180; pDirty = true; });
      els[4].addEventListener('click', function () { partials.splice(i, 1); renderPartials(); });
      host.appendChild(row);
    });
    pDirty = true;
  }

  var PRESETS = {
    'Pure A440': {
      note: 'One sine, one spike. The whole point of the Fourier transform in a single picture.',
      parts: [[440, 1, 0]]
    },
    'Octave + fifth': {
      note: 'A440 with its octave (2:1) and fifth-above-octave (3:1). Harmonically related sines fuse into one periodic wave — this is why a "note" with many partials still has one pitch.',
      parts: [[440, 1, 0], [880, 0.5, 0], [1320, 0.33, 0]]
    },
    'Square wave build-up': {
      note: 'Odd harmonics at 1/n: 7 terms already look square. Fourier series in action — keep adding terms and the ripples (Gibbs phenomenon) squeeze toward the edges but never disappear.',
      parts: [1, 3, 5, 7, 9, 11, 13].map(function (n) { return [220 * n, 1 / n, 0]; })
    },
    'Sawtooth build-up': {
      note: 'Every harmonic at 1/n with alternating sign. Compare its spectrum with the square: the even harmonics are the only difference.',
      parts: [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return [220 * n, 1 / n, n % 2 ? 0 : Math.PI]; })
    },
    'Beating pair': {
      note: '440 + 444 Hz: the spectrum shows two clean spikes, but the time domain throbs at 4 Hz. Beating lives in the time domain; the FFT calmly reports both tones.',
      parts: [[440, 0.8, 0], [444, 0.8, 0]]
    },
    'Cancellation': {
      note: 'Two identical tones, 180° apart. The sum is exactly zero — the FFT sees nothing, because there is nothing. This is noise cancelling in its purest form (see the 2D tab).',
      parts: [[440, 0.8, 0], [440, 0.8, Math.PI]]
    },
    'Spectral leakage': {
      note: '437.3 Hz does not land on an FFT bin (Δf shown top-right). With a rectangular window the energy smears across many bins; switch to Hann and watch it pull back together.',
      parts: [[437.3, 1, 0]]
    }
  };

  function applyPreset(name) {
    partials = PRESETS[name].parts.map(function (p) { return { f: p[0], a: p[1], ph: p[2], on: true }; });
    UI.el('sum-preset-note').textContent = PRESETS[name].note;
    renderPartials();
  }

  function makeSignal(N, sr) {
    var x = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var t = i / sr, s = 0;
      for (var j = 0; j < partials.length; j++) {
        var p = partials[j];
        if (p.on) s += p.a * Math.sin(2 * Math.PI * p.f * t + p.ph);
      }
      if (cfg.noise) s += cfg.noise * (Math.random() * 2 - 1);
      x[i] = s;
    }
    return x;
  }

  function equationText() {
    var terms = partials.filter(function (p) { return p.on; }).map(function (p) {
      var ph = Math.round(p.ph * 180 / Math.PI);
      return p.a.toFixed(2) + '·sin(2π·' + (+p.f.toFixed(1)) + '·t' + (ph ? ' + ' + ph + '°' : '') + ')';
    });
    UI.el('sum-eq').textContent = terms.length ? 'x(t) = ' + terms.join('  +  ') +
      (cfg.noise ? '  +  ' + cfg.noise.toFixed(2) + '·noise(t)' : '') : 'x(t) = 0';
  }

  var lastSpec = null, lastSig = null;

  function computeSum() {
    var N = cfg.N, sr = cfg.sr;
    lastSig = makeSignal(N, sr);
    // window + FFT
    var re = new Float32Array(N), im = new Float32Array(N);
    var wfn = DSP.WINDOWS[cfg.win], wsum = 0;
    for (var i = 0; i < N; i++) {
      var wv = wfn(i, N);
      wsum += wv;
      re[i] = lastSig[i] * wv;
    }
    DSP.fft(re, im);
    var half = N / 2, mag = new Float32Array(half);
    for (i = 0; i < half; i++) {
      // normalise: /wsum*2 makes an on-bin unit sine read 1.0
      mag[i] = Math.hypot(re[i], im[i]) / wsum * 2;
    }
    lastSpec = mag;
    equationText();
    peaksTable(mag, sr, N);
    UI.el('sum-wave-tag').textContent = 'N = ' + N + ' samples · fs = ' + sr + ' Hz · ' + (N / sr * 1000).toFixed(1) + ' ms';
    UI.el('sum-fft-tag').textContent = 'Δf = fs/N = ' + (sr / N).toFixed(2) + ' Hz/bin · ' + cfg.win + ' window';
  }

  function peaksTable(mag, sr, N) {
    var peaks = [];
    for (var i = 2; i < mag.length - 2; i++) {
      if (mag[i] > 0.004 && mag[i] > mag[i - 1] && mag[i] >= mag[i + 1]) {
        // parabolic interpolation refines the frequency estimate between bins
        var la = Math.log(mag[i - 1] + 1e-12), lb = Math.log(mag[i] + 1e-12), lc = Math.log(mag[i + 1] + 1e-12);
        var d = 0.5 * (la - lc) / (la - 2 * lb + lc || 1e-9);
        peaks.push({ bin: i, f: (i + d) * sr / N, m: mag[i] });
      }
    }
    peaks.sort(function (a, b) { return b.m - a.m; });
    peaks = peaks.slice(0, 8).sort(function (a, b) { return a.f - b.f; });
    var t = UI.el('sum-peaks');
    if (!peaks.length) { t.innerHTML = '<tr><td style="color:var(--txt-faint)">no peaks above the floor — is everything cancelled or muted?</td></tr>'; return; }
    var html = '<tr><th>Bin</th><th>Interpolated freq</th><th>Magnitude</th><th>dB</th></tr>';
    peaks.forEach(function (p) {
      html += '<tr><td>' + p.bin + '</td><td class="n">' + p.f.toFixed(1) + ' Hz</td><td>' +
        p.m.toFixed(3) + '</td><td>' + (20 * Math.log10(p.m + 1e-9)).toFixed(1) + '</td></tr>';
    });
    t.innerHTML = html;
  }

  function drawSumWave() {
    var canvas = UI.el('sum-wave');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 4, 8);
    if (!lastSig) return;
    var active = partials.filter(function (p) { return p.on; });
    // show a window sized to ~4 periods of the slowest active partial
    var fmin = active.length ? Math.min.apply(null, active.map(function (p) { return p.f; })) : 100;
    var span = Math.min(lastSig.length, Math.max(32, Math.round(cfg.sr * 4 / fmin)));
    var maxAbs = 0.001;
    for (var i = 0; i < span; i++) maxAbs = Math.max(maxAbs, Math.abs(lastSig[i]));
    var ysc = (h / 2) * 0.9 / Math.max(1, maxAbs);

    // faint individual components
    active.forEach(function (p, pi) {
      g.strokeStyle = COLORS[partials.indexOf(p) % COLORS.length] + '44';
      g.lineWidth = 1;
      g.beginPath();
      for (var i = 0; i < span; i++) {
        var t = i / cfg.sr;
        var y = h / 2 - p.a * Math.sin(2 * Math.PI * p.f * t + p.ph) * ysc;
        i ? g.lineTo(i / span * w, y) : g.moveTo(0, y);
      }
      g.stroke();
    });
    // the sum
    g.strokeStyle = '#e7ecf5';
    g.lineWidth = 2;
    g.beginPath();
    for (i = 0; i < span; i++) {
      var y = h / 2 - lastSig[i] * ysc;
      i ? g.lineTo(i / span * w, y) : g.moveTo(0, y);
    }
    g.stroke();
  }

  function drawSumFFT() {
    var canvas = UI.el('sum-fft');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 4, 8);
    if (!lastSpec) return;
    var half = lastSpec.length, sr = cfg.sr;
    var fmax = sr / 2, fminLog = 20;
    var toX = function (bin) {
      var fq = bin * sr / (2 * half);
      if (cfg.logx) {
        if (fq < fminLog) return -1;
        return w * (Math.log10(fq) - Math.log10(fminLog)) / (Math.log10(fmax) - Math.log10(fminLog));
      }
      return bin / half * w;
    };
    var toY = function (m) {
      if (cfg.logy) {
        var db = 20 * Math.log10(m + 1e-6);        // 0 dB top, -90 bottom
        return h * Math.min(1, Math.max(0, -db / 90));
      }
      return h * (1 - Math.min(1, m));
    };
    g.strokeStyle = '#3ddbd9';
    g.fillStyle = 'rgba(61,219,217,.25)';
    g.lineWidth = 1.4;
    g.beginPath();
    var started = false;
    for (var i = 1; i < half; i++) {
      var x = toX(i);
      if (x < 0) continue;
      var y = toY(lastSpec[i]);
      if (!started) { g.moveTo(x, h); started = true; }
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.fill();
    g.stroke();
    // axis labels
    g.fillStyle = 'rgba(142,153,176,.9)';
    g.font = '9px ui-monospace,monospace';
    var marks = cfg.logx ? [50, 100, 200, 500, 1000, 2000, 5000] : [0.25, 0.5, 0.75].map(function (r) { return r * fmax; });
    marks.forEach(function (m) {
      if (m > fmax) return;
      var x = cfg.logx
        ? w * (Math.log10(m) - Math.log10(fminLog)) / (Math.log10(fmax) - Math.log10(fminLog))
        : m / fmax * w;
      g.fillText(m >= 1000 ? (m / 1000) + 'k' : Math.round(m), x + 2, h - 4);
    });
    g.fillText(cfg.logy ? '0 dB … −90 dB' : 'linear 0…1', 6, 26);
    // mark the true partial frequencies
    partials.forEach(function (p, i) {
      if (!p.on || p.f > fmax) return;
      var x = cfg.logx
        ? (p.f < fminLog ? -1 : w * (Math.log10(p.f) - Math.log10(fminLog)) / (Math.log10(fmax) - Math.log10(fminLog)))
        : p.f / fmax * w;
      if (x < 0) return;
      g.strokeStyle = COLORS[i % COLORS.length] + '99';
      g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 14); g.stroke();
      g.setLineDash([]);
    });
  }

  function playSum() {
    Engine.init();
    if (!Engine.ready()) return;
    stopSum();
    var ctx = Engine.ctx, sr = ctx.sampleRate;
    var len = sr, buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    var norm = 0;
    partials.forEach(function (p) { if (p.on) norm += p.a; });
    norm = Math.max(1, norm);
    for (var i = 0; i < len; i++) {
      var t = i / sr, s = 0;
      for (var j = 0; j < partials.length; j++) {
        var p = partials[j];
        if (p.on && p.f < sr / 2) s += p.a * Math.sin(2 * Math.PI * p.f * t + p.ph);
      }
      if (cfg.noise) s += cfg.noise * (Math.random() * 2 - 1);
      d[i] = s / (norm + cfg.noise) * 0.8;
    }
    playSrc = ctx.createBufferSource();
    playSrc.buffer = buf;
    playSrc.loop = true;
    playSrc.connect(Engine.master);
    playSrc.start();
  }
  function stopSum() { if (playSrc) { try { playSrc.stop(); } catch (e) {} playSrc = null; } }

  // ==================================================== 2 · ANC 2D
  var anc = {
    freq: 400, phase: Math.PI, amp: 1, anim: true, t: 0,
    A: { x: 0.32, y: 0.5 }, B: { x: 0.42, y: 0.5 }, L: { x: 0.75, y: 0.5 },
    drag: null
  };
  var PLATE = 4;                 // metres across
  var C_SOUND = 343;
  var ancImg = null, ancW = 0, ancH = 0;
  var ancTone = null;

  function ancField() {
    var canvas = UI.el('anc-field');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    var gw = 170, gh = Math.max(40, Math.round(gw * h / w));
    if (!ancImg || ancW !== gw || ancH !== gh) {
      ancW = gw; ancH = gh;
      ancImg = g.createImageData(gw, gh);
    }
    var k = 2 * Math.PI * anc.freq / C_SOUND;      // wavenumber
    var px = ancImg.data;
    // keep the geometry square: metres per cell horizontally == vertically
    var mppx = PLATE / gw;
    var Ay = anc.A.y * gh * mppx, Ax = anc.A.x * gw * mppx;
    var By = anc.B.y * gh * mppx, Bx = anc.B.x * gw * mppx;
    var omegaT = anc.anim ? anc.t : 0;
    var i = 0;
    for (var y = 0; y < gh; y++) {
      var wy = y * mppx;
      for (var x = 0; x < gw; x++) {
        var wx = x * mppx;
        var dxa = wx - Ax, dya = wy - Ay;
        var rA = Math.sqrt(dxa * dxa + dya * dya) + 0.04;
        var dxb = wx - Bx, dyb = wy - By;
        var rB = Math.sqrt(dxb * dxb + dyb * dyb) + 0.04;
        var gA = 1 / rA, gB = anc.amp / rB;
        var r, gr, b;
        if (anc.anim) {
          // instantaneous pressure — travelling ripples
          var p = gA * Math.sin(omegaT - k * rA) + gB * Math.sin(omegaT - k * rB + anc.phase);
          var v = Math.max(-1, Math.min(1, p * 0.7));
          if (v > 0) { r = 22 + 233 * v; gr = 26 + 153 * v; b = 36 + 35 * v; }
          else { v = -v; r = 22 + 21 * v; gr = 26 + 82 * v; b = 36 + 219 * v; }
        } else {
          // steady-state amplitude relative to perfect reinforcement
          var reS = gA * Math.cos(-k * rA) + gB * Math.cos(-k * rB + anc.phase);
          var imS = gA * Math.sin(-k * rA) + gB * Math.sin(-k * rB + anc.phase);
          var ratio = Math.sqrt(reS * reS + imS * imS) / (gA + gB);   // 0 cancel … 1 reinforce
          if (ratio < 0.5) {
            var t2 = 1 - ratio * 2;                 // 1 at full cancel
            r = 22; gr = 26 + 82 * t2; b = 36 + 219 * t2;
          } else {
            var t3 = (ratio - 0.5) * 2;
            r = 22 + 233 * t3; gr = 26 + 153 * t3; b = 36 + 35 * t3;
          }
        }
        px[i++] = r; px[i++] = gr; px[i++] = b; px[i++] = 255;
      }
    }
    // blit the coarse grid, scaled up smoothly
    var off = ancField.off = ancField.off || document.createElement('canvas');
    if (off.width !== gw || off.height !== gh) { off.width = gw; off.height = gh; }
    off.getContext('2d').putImageData(ancImg, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(off, 0, 0, w, h);

    // sources + listener markers
    function mark(pt, txt, color) {
      var x = pt.x * w, y = pt.y * h;
      g.beginPath(); g.arc(x, y, 9, 0, 7);
      g.fillStyle = color; g.fill();
      g.strokeStyle = '#0b0d12'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#0b0d12';
      g.font = '700 10px ui-monospace,monospace';
      g.textAlign = 'center';
      g.fillText(txt, x, y + 3.5);
      g.textAlign = 'left';
    }
    mark(anc.A, 'A', '#ffb347');
    mark(anc.B, 'B', '#3ddbd9');
    var lx = anc.L.x * w, ly = anc.L.y * h;
    g.strokeStyle = '#fff'; g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(lx - 7, ly - 7); g.lineTo(lx + 7, ly + 7);
    g.moveTo(lx + 7, ly - 7); g.lineTo(lx - 7, ly + 7);
    g.stroke();
    if (anc.anim) anc.t += 2 * Math.PI * 1.1 / 60;   // ~1.1 wave cycles per second on screen
  }

  function ancListener() {
    // same world mapping as the field: x spans PLATE metres, y spans PLATE * canvas aspect
    var cv = UI.el('anc-field');
    var aspect = cv.clientWidth ? (cv.clientHeight || 470) / cv.clientWidth : 0.7;
    var dxa = (anc.L.x - anc.A.x) * PLATE, dya = (anc.L.y - anc.A.y) * PLATE * aspect;
    var dxb = (anc.L.x - anc.B.x) * PLATE, dyb = (anc.L.y - anc.B.y) * PLATE * aspect;
    var rA = Math.sqrt(dxa * dxa + dya * dya) + 0.04;
    var rB = Math.sqrt(dxb * dxb + dyb * dyb) + 0.04;
    var k = 2 * Math.PI * anc.freq / C_SOUND;
    var gA = 1 / rA, gB = anc.amp / rB;
    var reS = gA * Math.cos(-k * rA) + gB * Math.cos(-k * rB + anc.phase);
    var imS = gA * Math.sin(-k * rA) + gB * Math.sin(-k * rB + anc.phase);
    var sum = Math.sqrt(reS * reS + imS * imS);
    var reduction = 20 * Math.log10((sum + 1e-6) / (gA + 1e-6));
    return { rA: rA, rB: rB, gA: gA, gB: gB, sum: sum, k: k, red: reduction };
  }

  function ancReadout() {
    var m = ancListener();
    var lambda = C_SOUND / anc.freq;
    UI.el('anc-read').innerHTML =
      '<div class="kv"><span>Wavelength λ</span><span>' + (lambda * 100).toFixed(1) + ' cm</span></div>' +
      '<div class="kv"><span>Distance from A</span><span>' + m.rA.toFixed(2) + ' m</span></div>' +
      '<div class="kv"><span>Distance from B</span><span>' + m.rB.toFixed(2) + ' m</span></div>' +
      '<div class="kv"><span>Path difference</span><span>' + Math.abs(m.rA - m.rB).toFixed(3) + ' m = ' +
        (Math.abs(m.rA - m.rB) / lambda).toFixed(2) + ' λ</span></div>' +
      '<div class="kv"><span>Level vs A alone</span><span>' +
        (m.red > -0.05 ? '+' : '') + m.red.toFixed(1) + ' dB ' +
        (m.red < -20 ? '· cancelled ✓' : m.red > 4 ? '· reinforced' : '') + '</span></div>';
  }

  function anc1D() {
    var canvas = UI.el('anc-1d');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 2, 8);
    var m = ancListener();
    var periods = 3;
    function trace(color, fn, width) {
      g.strokeStyle = color; g.lineWidth = width || 1.3;
      g.beginPath();
      for (var i = 0; i <= w; i++) {
        var t = i / w * periods * 2 * Math.PI;
        var y = h / 2 - fn(t) * h * 0.4;
        i ? g.lineTo(i, y) : g.moveTo(i, y);
      }
      g.stroke();
    }
    var norm = Math.max(m.gA + m.gB, 1e-6);
    trace('#ffb34799', function (t) { return m.gA * Math.sin(t - m.k * m.rA) / norm * 2; });
    trace('#3ddbd999', function (t) { return m.gB * Math.sin(t - m.k * m.rB + anc.phase) / norm * 2; });
    trace('#ffffff', function (t) {
      return (m.gA * Math.sin(t - m.k * m.rA) + m.gB * Math.sin(t - m.k * m.rB + anc.phase)) / norm * 2;
    }, 2.2);
  }

  function ancHear(both) {
    Engine.init();
    if (!Engine.ready()) return;
    ancStop();
    var ctx = Engine.ctx, sr = ctx.sampleRate;
    var m = ancListener();
    var len = sr, buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    var norm = Math.max(m.gA + (both ? m.gB : 0), 1e-6);
    for (var i = 0; i < len; i++) {
      var t = 2 * Math.PI * anc.freq * i / sr;
      var s = m.gA * Math.sin(t - m.k * m.rA);
      if (both) s += m.gB * Math.sin(t - m.k * m.rB + anc.phase);
      d[i] = s / norm * 0.7;
    }
    ancTone = ctx.createBufferSource();
    ancTone.buffer = buf; ancTone.loop = true;
    ancTone.connect(Engine.master);
    ancTone.start();
  }
  function ancStop() { if (ancTone) { try { ancTone.stop(); } catch (e) {} ancTone = null; } }

  function ancPointer() {
    var canvas = UI.el('anc-field');
    function pos(ev) {
      var r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
    }
    canvas.addEventListener('pointerdown', function (ev) {
      var p = pos(ev);
      var targets = [['A', anc.A], ['B', anc.B], ['L', anc.L]];
      var best = null, bd = 1e9;
      targets.forEach(function (t) {
        var d = Math.hypot(t[1].x - p.x, t[1].y - p.y);
        if (d < bd) { bd = d; best = t[1]; }
      });
      if (bd < 0.09) { anc.drag = best; canvas.setPointerCapture(ev.pointerId); }
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (!anc.drag) return;
      var p = pos(ev);
      anc.drag.x = Math.max(0.02, Math.min(0.98, p.x));
      anc.drag.y = Math.max(0.02, Math.min(0.98, p.y));
    });
    canvas.addEventListener('pointerup', function () { anc.drag = null; });
  }

  // ==================================================== 3 · ALIASING
  var al = { f: 300, sr: 2000, bits: 16 };

  function aliasInfo() {
    var nyq = al.sr / 2;
    var fa = al.f % al.sr;
    var flip = false;
    if (fa > nyq) { fa = al.sr - fa; flip = true; }
    return { nyq: nyq, fa: fa, flip: flip, aliased: al.f > nyq };
  }

  function quantize(v, bits) {
    var steps = Math.pow(2, bits - 1) - 1;
    return Math.round(v * steps) / steps;
  }

  function drawAlias() {
    var info = aliasInfo();
    var canvas = UI.el('alias-wave');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 4, 8);

    var fShow = Math.max(1, Math.min(al.f, info.fa || al.f));
    var T = 4 / fShow;                       // seconds displayed
    T = Math.max(T, 10 / al.sr);             // always show at least 10 samples

    // true signal
    g.strokeStyle = '#5d6880';
    g.lineWidth = 1.6;
    g.beginPath();
    for (var i = 0; i <= w; i++) {
      var t = i / w * T;
      var y = h / 2 - Math.sin(2 * Math.PI * al.f * t) * h * 0.4;
      i ? g.lineTo(i, y) : g.moveTo(i, y);
    }
    g.stroke();

    // reconstruction (the alias) — dashed amber
    g.strokeStyle = '#ffb347';
    g.lineWidth = 2;
    g.setLineDash(info.aliased ? [6, 4] : []);
    g.beginPath();
    for (i = 0; i <= w; i++) {
      t = i / w * T;
      var s = Math.sin(2 * Math.PI * info.fa * t) * (info.flip ? -1 : 1);
      var y2 = h / 2 - quantize(s, al.bits) * h * 0.4;
      i ? g.lineTo(i, y2) : g.moveTo(i, y2);
    }
    g.stroke();
    g.setLineDash([]);

    // sample points
    var n = 0;
    g.fillStyle = '#3ddbd9';
    for (var ts = 0; ts <= T; ts += 1 / al.sr) {
      var x = ts / T * w;
      var v = quantize(Math.sin(2 * Math.PI * al.f * ts), al.bits);
      var y3 = h / 2 - v * h * 0.4;
      g.beginPath(); g.arc(x, y3, 3, 0, 7); g.fill();
      g.strokeStyle = 'rgba(61,219,217,.35)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x, y3); g.stroke();
      if (++n > 400) break;
    }

    // error plot
    var canvas2 = UI.el('alias-err');
    var f2 = Viz.fit(canvas2), g2 = f2.g, w2 = f2.w, h2 = f2.h;
    Viz.bg(g2, w2, h2, 2, 8);
    g2.strokeStyle = '#ff6b9d';
    g2.lineWidth = 1.4;
    g2.beginPath();
    for (i = 0; i <= w2; i++) {
      t = i / w2 * T;
      var tv = Math.sin(2 * Math.PI * al.f * t);
      var err = quantize(tv, al.bits) - tv;
      var y4 = h2 / 2 - err * h2 * 3;
      i ? g2.lineTo(i, y4) : g2.moveTo(i, y4);
    }
    g2.stroke();
    g2.fillStyle = 'rgba(142,153,176,.85)';
    g2.font = '9px ui-monospace,monospace';
    g2.textAlign = 'right';
    g2.fillText('error ×6 zoom', w2 - 8, 12);
    g2.textAlign = 'left';

    UI.el('alias-read').innerHTML =
      '<div class="kv"><span>Nyquist limit fs/2</span><span>' + info.nyq + ' Hz</span></div>' +
      '<div class="kv"><span>Reconstructed as</span><span>' + info.fa.toFixed(1) + ' Hz' +
        (info.aliased ? ' ⚠ ALIAS' : ' ✓ faithful') + '</span></div>' +
      '<div class="kv"><span>Dynamic range</span><span>' + (6.02 * al.bits + 1.76).toFixed(1) + ' dB</span></div>';
  }

  // ==================================================== boot
  function boot() {
    // --- subtabs
    var tabs = UI.el('math-tabs');
    tabs.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      sub = b.dataset.sub;
      Array.prototype.forEach.call(tabs.children, function (c) {
        c.classList.toggle('on', c === b);
      });
      UI.el('math-sum').classList.toggle('hidden', sub !== 'sum');
      UI.el('math-anc').classList.toggle('hidden', sub !== 'anc');
      UI.el('math-conv').classList.toggle('hidden', sub !== 'conv');
    });

    // --- sum
    var pc = UI.el('sum-presets');
    Object.keys(PRESETS).forEach(function (name) {
      var b = document.createElement('button');
      b.className = 'btn sm';
      b.textContent = name;
      b.addEventListener('click', function () { applyPreset(name); });
      pc.appendChild(b);
    });
    UI.el('sum-add').addEventListener('click', function () {
      addPartial(220 * (partials.length + 1), 0.5, 0);
    });
    UI.el('sum-play').addEventListener('click', playSum);
    UI.el('sum-stop').addEventListener('click', stopSum);
    UI.slider('sum-n', function (v) { cfg.N = 1 << v; pDirty = true; }, function (v) { return 1 << v; });
    UI.slider('sum-sr', function (v) { cfg.sr = v; pDirty = true; }, function (v) { return v + ' Hz'; });
    UI.slider('sum-noise', function (v) { cfg.noise = v; pDirty = true; }, UI.pctFmt);
    UI.el('sum-window').addEventListener('change', function () { cfg.win = this.value; pDirty = true; });
    UI.el('sum-logy').addEventListener('click', function () {
      cfg.logy = !cfg.logy; this.classList.toggle('on', cfg.logy); pDirty = true;
    });
    UI.el('sum-logx').addEventListener('click', function () {
      cfg.logx = !cfg.logx; this.classList.toggle('on', cfg.logx); pDirty = true;
    });
    applyPreset('Octave + fifth');

    // --- anc
    UI.slider('anc-freq', function (v) { anc.freq = v; }, function (v) { return v + ' Hz'; });
    UI.slider('anc-phase', function (v) { anc.phase = v * Math.PI / 180; }, function (v) { return v + '°'; });
    UI.slider('anc-amp', function (v) { anc.amp = v; }, UI.pctFmt);
    UI.el('anc-invert').addEventListener('click', function () {
      var deg = Math.round(anc.phase * 180 / Math.PI);
      deg = (deg + 180) % 360;
      UI.el('anc-phase').value = deg;
      UI.el('anc-phase').dispatchEvent(new Event('input'));
    });
    UI.el('anc-anim').addEventListener('click', function () {
      anc.anim = !anc.anim;
      this.classList.toggle('on', anc.anim);
      this.textContent = anc.anim ? 'Animate' : 'Show amplitude map';
    });
    UI.el('anc-hear-a').addEventListener('click', function () { ancHear(false); });
    UI.el('anc-hear-both').addEventListener('click', function () { ancHear(true); });
    UI.el('anc-hear-stop').addEventListener('click', ancStop);
    ancPointer();

    // --- aliasing
    UI.slider('alias-f', function (v) { al.f = v; }, function (v) { return v + ' Hz'; });
    UI.slider('alias-sr', function (v) { al.sr = v; }, function (v) { return v + ' Hz'; });
    UI.slider('alias-bits', function (v) { al.bits = v; }, function (v) { return v + ' bits'; });

    // --- frame
    var lastCfg = '';
    Frame.add('math', function () {
      if (sub === 'sum') {
        var sig = JSON.stringify([partials, cfg.N, cfg.sr, cfg.noise, cfg.win]);
        if (pDirty || sig !== lastCfg) { computeSum(); pDirty = false; lastCfg = sig; }
        drawSumWave();
        drawSumFFT();
      } else if (sub === 'anc') {
        ancField();
        anc1D();
        ancReadout();
      } else {
        drawAlias();
      }
    });
  }

  global.ViewMath = { boot: boot };
})(window);
