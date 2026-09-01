/* ============================================================
   view-amp.js — preamp drive, tone stack, presence and cabinet,
   with the live EQ curve and transfer function plotted from the
   actual audio nodes.
   ============================================================ */
(function (global) {
  'use strict';

  var G = null;               // the amp graph, built lazily
  var loopTimer = null, micStream = null, micNode = null, sweepOsc = null, noiseSrc = null;
  var params = { type: 'soft', gain: 0.2, master: 0.6, cab: true };

  function build() {
    if (G) return G;
    Engine.init();
    var ctx = Engine.ctx;
    G = {};
    G.input = Engine.gain(1);                    // everything feeds this
    G.dryTap = Engine.analyser(2048, 0.6);
    G.pre = Engine.gain(1);
    G.shaper = ctx.createWaveShaper();
    G.shaper.oversample = '4x';

    G.bass = ctx.createBiquadFilter();
    G.bass.type = 'lowshelf'; G.bass.frequency.value = 100;
    G.mid = ctx.createBiquadFilter();
    G.mid.type = 'peaking'; G.mid.frequency.value = 650; G.mid.Q.value = 0.9;
    G.treble = ctx.createBiquadFilter();
    G.treble.type = 'highshelf'; G.treble.frequency.value = 3200;
    G.presence = ctx.createBiquadFilter();
    G.presence.type = 'peaking'; G.presence.frequency.value = 6000; G.presence.Q.value = 1.1;

    G.cabHP = ctx.createBiquadFilter();
    G.cabHP.type = 'highpass'; G.cabHP.frequency.value = 75; G.cabHP.Q.value = 0.7;
    G.cabLP = ctx.createBiquadFilter();
    G.cabLP.type = 'lowpass'; G.cabLP.frequency.value = 4800; G.cabLP.Q.value = 1.1;
    G.cabBump = ctx.createBiquadFilter();
    G.cabBump.type = 'peaking'; G.cabBump.frequency.value = 2400; G.cabBump.Q.value = 1.4; G.cabBump.gain.value = 3;

    G.out = Engine.gain(params.master);
    G.wetTap = Engine.analyser(2048, 0.6);

    G.input.connect(G.dryTap);
    G.input.connect(G.pre);
    G.pre.connect(G.shaper);
    G.shaper.connect(G.bass);
    G.bass.connect(G.mid);
    G.mid.connect(G.treble);
    G.treble.connect(G.presence);
    // presence -> (cab?) -> out, wired by setCab()
    G.out.connect(G.wetTap);
    G.wetTap.connect(Engine.master);

    setCab(params.cab);
    setDrive();
    return G;
  }

  function setCab(on) {
    params.cab = on;
    try { G.presence.disconnect(); G.cabBump.disconnect(); } catch (e) {}
    if (on) {
      G.presence.connect(G.cabHP);
      G.cabHP.connect(G.cabLP);
      G.cabLP.connect(G.cabBump);
      G.cabBump.connect(G.out);
    } else {
      G.presence.connect(G.out);
    }
    UI.el('amp-cab').classList.toggle('on', on);
  }

  function setDrive() {
    if (!G) return;
    var t = params.type === 'clean' ? 'clean' : params.type;
    G.shaper.curve = DSP.shaperCurve(t, params.gain);
    // pre-gain pushes the signal into the curve; keep unity for 'clean'
    G.pre.gain.value = params.type === 'clean' ? 1 : 1 + params.gain * 2.5;
    // rough loudness compensation so cranking gain is not just "louder"
    G.out.gain.value = params.master * (params.type === 'clean' ? 1 : 1 / (1 + params.gain * 1.4));
    UI.el('amp-xfer-tag').textContent =
      params.type === 'clean' ? 'linear' : params.type + ' clip · drive ' + Math.round(params.gain * 100) + '%';
  }

  // ------------------------------------------------ sources
  function stopSources() {
    if (sweepOsc) { try { sweepOsc.stop(); } catch (e) {} sweepOsc = null; }
    if (noiseSrc) { try { noiseSrc.stop(); } catch (e) {} noiseSrc = null; }
    if (micNode) { try { micNode.disconnect(); } catch (e) {} micNode = null; }
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
  }

  function strike() {
    build();
    if (!Engine.ready()) return;
    var src = UI.el('amp-src').value;
    var ctx = Engine.ctx, t0 = ctx.currentTime;

    if (src === 'sweep') {
      stopSources();
      sweepOsc = ctx.createOscillator();
      sweepOsc.type = 'sine';
      sweepOsc.frequency.setValueAtTime(20, t0);
      sweepOsc.frequency.exponentialRampToValueAtTime(18000, t0 + 6);
      var g = Engine.gain(0.5);
      sweepOsc.connect(g); g.connect(G.input);
      sweepOsc.start(t0); sweepOsc.stop(t0 + 6.1);
      return;
    }
    if (src === 'pink') {
      stopSources();
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = DSP.noiseBuffer(ctx, 2);
      noiseSrc.loop = true;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 0.2;
      var ng = Engine.gain(0.4);
      noiseSrc.connect(lp); lp.connect(ng); ng.connect(G.input);
      noiseSrc.start(t0); noiseSrc.stop(t0 + 4);
      return;
    }
    if (src === 'mic') { enableMic(); return; }

    // guitar/bass chord strum via the shared voice library
    var roots = { electric: [40, 47, 52, 56, 59, 64], acoustic: [40, 47, 52, 56, 59, 64], bass: [28, 35] };
    (roots[src] || roots.electric).forEach(function (m, i) {
      Voices.play(G.input, src, Music.midiToFreq(m),
        { velocity: 0.5, when: t0 + i * 0.04 });
    });
  }

  function enableMic() {
    if (micNode) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } })
      .then(function (stream) {
        micStream = stream;
        micNode = Engine.ctx.createMediaStreamSource(stream);
        micNode.connect(G.input);
      })
      .catch(function () { /* user said no — nothing to do */ });
  }

  // ------------------------------------------------ drawings
  var respFreqs = null, magBufs = null;
  function drawResponse() {
    var canvas = UI.el('amp-resp');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 4, 8);
    if (!G) { Viz.label(canvas, 'power on to compute'); return; }

    var N = 180;
    if (!respFreqs || respFreqs.length !== N) {
      respFreqs = new Float32Array(N);
      var lmin = Math.log10(20), lmax = Math.log10(18000);
      for (var i = 0; i < N; i++) respFreqs[i] = Math.pow(10, lmin + (lmax - lmin) * i / (N - 1));
      magBufs = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    }
    var filters = [G.bass, G.mid, G.treble, G.presence];
    if (params.cab) filters.push(G.cabHP, G.cabLP, G.cabBump);
    var total = new Float32Array(N);
    filters.forEach(function (flt) {
      flt.getFrequencyResponse(respFreqs, magBufs[0], magBufs[1]);
      for (var i = 0; i < N; i++) total[i] += 20 * Math.log10(Math.max(1e-6, magBufs[0][i]));
    });

    // 0 dB line
    g.strokeStyle = 'rgba(142,153,176,.6)';
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.setLineDash([]);

    g.strokeStyle = '#ffb347';
    g.lineWidth = 2.2;
    g.beginPath();
    for (var i = 0; i < N; i++) {
      var x = i / (N - 1) * w;
      var y = h / 2 - (total[i] / 24) * (h / 2) * 0.92;
      y = Math.max(2, Math.min(h - 2, y));
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(142,153,176,.9)';
    g.font = '9px ui-monospace,monospace';
    [100, 1000, 10000].forEach(function (m) {
      var x = w * (Math.log10(m) - Math.log10(20)) / (Math.log10(18000) - Math.log10(20));
      g.fillText(m >= 1000 ? m / 1000 + 'k' : m, x + 2, h - 4);
    });
  }

  function drawTransfer() {
    var canvas = UI.el('amp-xfer');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 4, 4);
    // reference diagonal
    g.strokeStyle = 'rgba(93,104,128,.55)';
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.stroke();
    g.setLineDash([]);
    var curve = G ? G.shaper.curve : null;
    if (!curve) { curve = DSP.shaperCurve(params.type === 'clean' ? 'clean' : params.type, params.gain); }
    g.strokeStyle = '#3ddbd9';
    g.lineWidth = 2.2;
    g.beginPath();
    for (var i = 0; i < curve.length; i += 4) {
      var x = i / (curve.length - 1) * w;
      var y = h / 2 - curve[i] * h / 2 * 0.92;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  var frameN = 0;
  function rms(analyser) {
    var buf = analyser.__tbuf = analyser.__tbuf || new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    var s = 0, p = 0;
    for (var i = 0; i < buf.length; i++) { s += buf[i] * buf[i]; p = Math.max(p, Math.abs(buf[i])); }
    return { rms: Math.sqrt(s / buf.length), peak: p };
  }

  function facts() {
    if (!G) return;
    var d = rms(G.dryTap), wv = rms(G.wetTap);
    var toDb = function (v) { return v < 1e-5 ? '−∞' : (20 * Math.log10(v)).toFixed(1); };
    var crest = function (m) { return m.rms < 1e-5 ? '—' : (m.peak / m.rms).toFixed(2); };
    UI.el('amp-facts').innerHTML =
      '<div class="kv"><span>Input RMS</span><span>' + toDb(d.rms) + ' dBFS</span></div>' +
      '<div class="kv"><span>Output RMS</span><span>' + toDb(wv.rms) + ' dBFS</span></div>' +
      '<div class="kv"><span>Input crest factor</span><span>' + crest(d) + '</span></div>' +
      '<div class="kv"><span>Output crest factor</span><span>' + crest(wv) + '</span></div>' +
      '<div class="kv"><span>Circuit</span><span>' + params.type + '</span></div>' +
      '<div class="kv"><span>Cabinet</span><span>' + (params.cab ? 'on' : 'off') + '</span></div>';
  }

  // ------------------------------------------------ presets
  var PRESETS = {
    'Clean sparkle': { type: 'clean', gain: 0.05, bass: 1, mid: 0, midf: 650, treble: 5, presence: 3, cab: true },
    'Blues crunch':  { type: 'soft', gain: 0.32, bass: 2, mid: 3, midf: 700, treble: 2, presence: 2, cab: true },
    'Classic rock':  { type: 'soft', gain: 0.55, bass: 3, mid: 1, midf: 800, treble: 4, presence: 4, cab: true },
    'Metal scoop':   { type: 'hard', gain: 0.82, bass: 6, mid: -12, midf: 650, treble: 5, presence: 5, cab: true },
    'Fuzz wall':     { type: 'fuzz', gain: 0.7, bass: 4, mid: 2, midf: 500, treble: 1, presence: 0, cab: true },
    'DI / flat':     { type: 'clean', gain: 0, bass: 0, mid: 0, midf: 650, treble: 0, presence: 0, cab: false }
  };

  function applyPreset(p) {
    UI.el('amp-type').value = p.type;
    params.type = p.type;
    var set = function (id, v) { UI.el(id).value = v; UI.el(id).dispatchEvent(new Event('input')); };
    set('amp-gain', p.gain);
    set('amp-bass', p.bass);
    set('amp-mid', p.mid);
    set('amp-midf', p.midf);
    set('amp-treble', p.treble);
    set('amp-presence', p.presence);
    if (G) setCab(p.cab); else params.cab = p.cab;
  }

  // ------------------------------------------------ boot
  function boot() {
    UI.slider('amp-gain', function (v) { params.gain = v; setDrive(); }, UI.pctFmt);
    UI.slider('amp-master', function (v) { params.master = v; setDrive(); }, UI.pctFmt);
    UI.slider('amp-bass', function (v) { if (G) G.bass.gain.value = v; }, UI.dbFmt);
    UI.slider('amp-mid', function (v) { if (G) G.mid.gain.value = v; }, UI.dbFmt);
    UI.slider('amp-midf', function (v) { if (G) G.mid.frequency.value = v; }, UI.hzFmt);
    UI.slider('amp-treble', function (v) { if (G) G.treble.gain.value = v; }, UI.dbFmt);
    UI.slider('amp-presence', function (v) { if (G) G.presence.gain.value = v; }, UI.dbFmt);

    UI.el('amp-type').addEventListener('change', function () {
      params.type = this.value; setDrive();
    });
    UI.el('amp-cab').addEventListener('click', function () {
      build(); setCab(!params.cab);
    });
    UI.el('amp-flat').addEventListener('click', function () {
      ['amp-bass', 'amp-mid', 'amp-treble', 'amp-presence'].forEach(function (id) {
        UI.el(id).value = 0; UI.el(id).dispatchEvent(new Event('input'));
      });
    });
    UI.el('amp-strum').addEventListener('click', strike);
    UI.el('amp-loop').addEventListener('click', function () {
      if (loopTimer) { clearInterval(loopTimer); loopTimer = null; this.classList.remove('on'); }
      else { strike(); loopTimer = setInterval(strike, 2000); this.classList.add('on'); }
    });
    UI.el('amp-src').addEventListener('change', stopSources);

    var pc = UI.el('amp-presets');
    Object.keys(PRESETS).forEach(function (name) {
      var b = document.createElement('button');
      b.className = 'btn sm';
      b.textContent = name;
      b.addEventListener('click', function () { build(); applyPreset(PRESETS[name]); });
      pc.appendChild(b);
    });

    // sync sliders into the graph the moment it exists
    var origBuild = build;
    build = function () {
      var had = !!G;
      var g = origBuild();
      if (!had) {
        ['amp-bass', 'amp-mid', 'amp-midf', 'amp-treble', 'amp-presence'].forEach(function (id) {
          UI.el(id).dispatchEvent(new Event('input'));
        });
        setDrive();
      }
      return g;
    };

    Frame.add('amp', function () {
      drawResponse();
      drawTransfer();
      if (G) {
        Viz.scope(UI.el('amp-scope'), G.dryTap, '#5d6880', { thin: true });
        Viz.scope(UI.el('amp-scope'), G.wetTap, '#ffb347', { overlay: true });
        Viz.spectrum(UI.el('amp-spec'), G.dryTap, '#5d6880', { lineOnly: true });
        Viz.spectrum(UI.el('amp-spec'), G.wetTap, '#ffb347', { overlay: true });
        if (++frameN % 12 === 0) facts();
      } else {
        var c1 = Viz.fit(UI.el('amp-scope')), c2 = Viz.fit(UI.el('amp-spec'));
        Viz.bg(c1.g, c1.w, c1.h, 4, 8); Viz.bg(c2.g, c2.w, c2.h, 4, 8);
      }
    });
  }

  global.ViewAmp = { boot: boot };
})(window);
