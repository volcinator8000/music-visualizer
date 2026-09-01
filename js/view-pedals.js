/* ============================================================
   view-pedals.js — a pedalboard of classic effects, every one
   built from native Web Audio nodes, with dry/wet comparison.
   ============================================================ */
(function (global) {
  'use strict';

  /* Each pedal: build(ctx) -> { input, output, set(param, value) }.
     The chain is rewired source -> [enabled pedals in order] -> output. */
  var PEDALS = [
    {
      key: 'comp', name: 'Compressor', sub: 'dynamics', color: '#7bd88f',
      desc: 'Evens out loud and quiet — squashes peaks, then raises everything.',
      params: [
        { id: 'thresh', label: 'Threshold', min: -60, max: 0, step: 1, value: -28, fmt: UI.dbFmt },
        { id: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, value: 6, fmt: function (v) { return v + ':1'; } },
        { id: 'makeup', label: 'Level', min: 0, max: 3, step: 0.05, value: 1.4, fmt: UI.pctFmt }
      ],
      build: function (ctx) {
        var c = ctx.createDynamicsCompressor();
        c.threshold.value = -28; c.ratio.value = 6; c.knee.value = 8;
        c.attack.value = 0.004; c.release.value = 0.12;
        var mk = Engine.gain(1.4);
        c.connect(mk);
        return { input: c, output: mk, set: function (p, v) {
          if (p === 'thresh') c.threshold.value = v;
          if (p === 'ratio') c.ratio.value = v;
          if (p === 'makeup') mk.gain.value = v;
        } };
      }
    },
    {
      key: 'wah', name: 'Auto-Wah', sub: 'filter', color: '#ffd166',
      desc: 'A resonant bandpass swept up and down — a vowel sound imposed on the guitar.',
      params: [
        { id: 'rate', label: 'Rate', min: 0.2, max: 8, step: 0.1, value: 1.6, fmt: function (v) { return v.toFixed(1) + ' Hz'; } },
        { id: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, value: 0.8, fmt: UI.pctFmt },
        { id: 'q', label: 'Resonance', min: 1, max: 14, step: 0.5, value: 6, fmt: function (v) { return 'Q ' + v; } }
      ],
      build: function (ctx) {
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 6;
        var lfo = ctx.createOscillator(), lg = Engine.gain(600);
        lfo.frequency.value = 1.6;
        lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
        var boost = Engine.gain(1.6);
        bp.connect(boost);
        return { input: bp, output: boost, set: function (p, v) {
          if (p === 'rate') lfo.frequency.value = v;
          if (p === 'depth') lg.gain.value = 750 * v;
          if (p === 'q') bp.Q.value = v;
        } };
      }
    },
    {
      key: 'od', name: 'Overdrive', sub: 'gain · soft clip', color: '#ffb347', xfer: 'soft',
      desc: 'Tube-style soft clipping: peaks round off gently, adding mostly low, warm harmonics.',
      params: [
        { id: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, value: 0.35, fmt: UI.pctFmt },
        { id: 'tone', label: 'Tone', min: 800, max: 8000, step: 50, value: 3500, fmt: UI.hzFmt },
        { id: 'level', label: 'Level', min: 0, max: 1.5, step: 0.01, value: 0.7, fmt: UI.pctFmt }
      ],
      build: function (ctx) { return driveBuild(ctx, 'soft', 0.35, 3500, 0.7); }
    },
    {
      key: 'dist', name: 'Distortion', sub: 'gain · hard clip', color: '#ff8c1a', xfer: 'hard',
      desc: 'Op-amp hard clipping: peaks are sliced flat, spraying strong odd harmonics far up the spectrum.',
      params: [
        { id: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, value: 0.5, fmt: UI.pctFmt },
        { id: 'tone', label: 'Tone', min: 800, max: 8000, step: 50, value: 3000, fmt: UI.hzFmt },
        { id: 'level', label: 'Level', min: 0, max: 1.5, step: 0.01, value: 0.55, fmt: UI.pctFmt }
      ],
      build: function (ctx) { return driveBuild(ctx, 'hard', 0.5, 3000, 0.55); }
    },
    {
      key: 'fuzz', name: 'Fuzz', sub: 'gain · square-out', color: '#ff5c5c', xfer: 'fuzz',
      desc: 'So much gain the wave collapses toward a square — almost all harmonic, barely any original signal.',
      params: [
        { id: 'drive', label: 'Fuzz', min: 0, max: 1, step: 0.01, value: 0.6, fmt: UI.pctFmt },
        { id: 'tone', label: 'Tone', min: 800, max: 8000, step: 50, value: 2600, fmt: UI.hzFmt },
        { id: 'level', label: 'Level', min: 0, max: 1.5, step: 0.01, value: 0.45, fmt: UI.pctFmt }
      ],
      build: function (ctx) { return driveBuild(ctx, 'fuzz', 0.6, 2600, 0.45); }
    },
    {
      key: 'octa', name: 'Octave Fuzz', sub: 'gain · rectifier', color: '#c084fc', xfer: 'cheby',
      desc: 'A Chebyshev-style folding curve: 2x² − 1 doubles every frequency, adding a ghost note an octave up.',
      params: [
        { id: 'drive', label: 'Blend', min: 0, max: 1, step: 0.01, value: 0.35, fmt: UI.pctFmt },
        { id: 'tone', label: 'Tone', min: 800, max: 8000, step: 50, value: 3200, fmt: UI.hzFmt },
        { id: 'level', label: 'Level', min: 0, max: 1.5, step: 0.01, value: 0.6, fmt: UI.pctFmt }
      ],
      build: function (ctx) { return driveBuild(ctx, 'cheby', 0.35, 3200, 0.6); }
    },
    {
      key: 'chorus', name: 'Chorus', sub: 'modulation', color: '#3ddbd9',
      desc: 'A short delayed copy whose delay wobbles — a phantom second guitarist slightly out of tune.',
      params: [
        { id: 'rate', label: 'Rate', min: 0.1, max: 6, step: 0.1, value: 0.9, fmt: function (v) { return v.toFixed(1) + ' Hz'; } },
        { id: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, value: 0.5, fmt: UI.pctFmt },
        { id: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, value: 0.5, fmt: UI.pctFmt }
      ],
      build: function (ctx) {
        var inp = Engine.gain(1), out = Engine.gain(1);
        var dry = Engine.gain(0.5), wet = Engine.gain(0.5);
        var dl = ctx.createDelay(0.1); dl.delayTime.value = 0.017;
        var lfo = ctx.createOscillator(), lg = Engine.gain(0.004);
        lfo.frequency.value = 0.9;
        lfo.connect(lg); lg.connect(dl.delayTime); lfo.start();
        inp.connect(dry); dry.connect(out);
        inp.connect(dl); dl.connect(wet); wet.connect(out);
        return { input: inp, output: out, set: function (p, v) {
          if (p === 'rate') lfo.frequency.value = v;
          if (p === 'depth') lg.gain.value = 0.008 * v;
          if (p === 'mix') { wet.gain.value = v; dry.gain.value = 1 - v * 0.5; }
        } };
      }
    },
    {
      key: 'phaser', name: 'Phaser', sub: 'modulation', color: '#a78bfa',
      desc: 'Four sweeping all-pass stages create moving notches — the swoosh is the notches combing through the harmonics.',
      params: [
        { id: 'rate', label: 'Rate', min: 0.1, max: 6, step: 0.1, value: 0.5, fmt: function (v) { return v.toFixed(1) + ' Hz'; } },
        { id: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, value: 0.7, fmt: UI.pctFmt }
      ],
      build: function (ctx) {
        var inp = Engine.gain(1), out = Engine.gain(1);
        var lfo = ctx.createOscillator(), lg = Engine.gain(420);
        lfo.frequency.value = 0.5; lfo.connect(lg); lfo.start();
        var stage = inp;
        for (var i = 0; i < 4; i++) {
          var ap = ctx.createBiquadFilter();
          ap.type = 'allpass'; ap.frequency.value = 400 + i * 220; ap.Q.value = 0.6;
          lg.connect(ap.frequency);
          stage.connect(ap); stage = ap;
        }
        stage.connect(out);
        inp.connect(out);   // mixing dry + all-passed creates the notches
        return { input: inp, output: out, set: function (p, v) {
          if (p === 'rate') lfo.frequency.value = v;
          if (p === 'depth') lg.gain.value = 600 * v;
        } };
      }
    },
    {
      key: 'trem', name: 'Tremolo', sub: 'modulation', color: '#ff6b9d',
      desc: 'Volume turned up and down by an LFO — amplitude modulation, the simplest effect there is.',
      params: [
        { id: 'rate', label: 'Rate', min: 0.5, max: 14, step: 0.1, value: 5, fmt: function (v) { return v.toFixed(1) + ' Hz'; } },
        { id: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, value: 0.6, fmt: UI.pctFmt }
      ],
      build: function (ctx) {
        var vca = Engine.gain(0.7);
        var lfo = ctx.createOscillator(), lg = Engine.gain(0.3);
        lfo.frequency.value = 5;
        lfo.connect(lg); lg.connect(vca.gain); lfo.start();
        return { input: vca, output: vca, set: function (p, v) {
          if (p === 'rate') lfo.frequency.value = v;
          if (p === 'depth') { lg.gain.value = v / 2; vca.gain.value = 1 - v / 2; }
        } };
      }
    },
    {
      key: 'delay', name: 'Delay', sub: 'time', color: '#5eead4',
      desc: 'Echoes: the output is fed back to the input, each pass a little quieter and darker.',
      params: [
        { id: 'time', label: 'Time', min: 0.05, max: 1, step: 0.01, value: 0.32, fmt: function (v) { return Math.round(v * 1000) + ' ms'; } },
        { id: 'fb', label: 'Feedback', min: 0, max: 0.85, step: 0.01, value: 0.38, fmt: UI.pctFmt },
        { id: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, value: 0.35, fmt: UI.pctFmt }
      ],
      build: function (ctx) {
        var inp = Engine.gain(1), out = Engine.gain(1), wet = Engine.gain(0.35);
        var dl = ctx.createDelay(1.2); dl.delayTime.value = 0.32;
        var fb = Engine.gain(0.38);
        var damp = ctx.createBiquadFilter();
        damp.type = 'lowpass'; damp.frequency.value = 3200;
        inp.connect(out);
        inp.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl);
        damp.connect(wet); wet.connect(out);
        return { input: inp, output: out, set: function (p, v) {
          if (p === 'time') dl.delayTime.setTargetAtTime(v, ctx.currentTime, 0.05);
          if (p === 'fb') fb.gain.value = v;
          if (p === 'mix') wet.gain.value = v;
        } };
      }
    },
    {
      key: 'verb', name: 'Reverb', sub: 'space', color: '#8ab4ff',
      desc: 'Thousands of overlapping reflections, here synthesised as decaying noise convolved with the signal.',
      params: [
        { id: 'size', label: 'Size', min: 0.3, max: 5, step: 0.1, value: 1.8, fmt: function (v) { return v.toFixed(1) + ' s'; } },
        { id: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, value: 0.35, fmt: UI.pctFmt }
      ],
      build: function (ctx) {
        var inp = Engine.gain(1), out = Engine.gain(1), wet = Engine.gain(0.35);
        var conv = ctx.createConvolver();
        conv.buffer = DSP.impulseResponse(ctx, 1.8, 2.6, 0.35);
        inp.connect(out);
        inp.connect(conv); conv.connect(wet); wet.connect(out);
        var pending = null;
        return { input: inp, output: out, set: function (p, v) {
          if (p === 'mix') wet.gain.value = v;
          if (p === 'size') {          // debounce: IR generation is not free
            clearTimeout(pending);
            pending = setTimeout(function () {
              conv.buffer = DSP.impulseResponse(ctx, v, 2.6, 0.35);
            }, 180);
          }
        } };
      }
    }
  ];

  /* shared builder for the drive pedals */
  function driveBuild(ctx, type, amt, toneHz, lvl) {
    var pre = Engine.gain(1 + amt * 3);
    var ws = ctx.createWaveShaper();
    ws.curve = DSP.shaperCurve(type, amt);
    ws.oversample = '4x';
    var tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = toneHz; tone.Q.value = 0.5;
    var out = Engine.gain(lvl);
    pre.connect(ws); ws.connect(tone); tone.connect(out);
    return { input: pre, output: out, shaper: ws, set: function (p, v) {
      if (p === 'drive') { ws.curve = DSP.shaperCurve(type, v); pre.gain.value = 1 + v * 3; }
      if (p === 'tone') tone.frequency.value = v;
      if (p === 'level') out.gain.value = v;
    } };
  }

  // ------------------------------------------------ state & wiring
  var G = null, built = {}, state = {};
  var bypassAll = false, loopTimer = null;
  var micStream = null, micNode = null, susOsc = null, susGain = null;

  PEDALS.forEach(function (p) {
    state[p.key] = { on: false, values: {} };
    p.params.forEach(function (pr) { state[p.key].values[pr.id] = pr.value; });
  });

  function build() {
    if (G) return;
    Engine.init();
    G = {};
    G.src = Engine.gain(1);
    G.dryTap = Engine.analyser(2048, 0.6);
    G.wetTap = Engine.analyser(2048, 0.6);
    G.out = Engine.gain(0.9);
    G.src.connect(G.dryTap);
    G.out.connect(G.wetTap);
    G.wetTap.connect(Engine.master);
    rewire();
  }

  function pedalNode(key) {
    if (!built[key]) {
      var def = PEDALS.filter(function (p) { return p.key === key; })[0];
      built[key] = def.build(Engine.ctx);
      for (var pid in state[key].values) built[key].set(pid, state[key].values[pid]);
    }
    return built[key];
  }

  function rewire() {
    if (!G) return;
    try { G.src.disconnect(); } catch (e) {}
    G.src.connect(G.dryTap);
    PEDALS.forEach(function (p) {
      if (built[p.key]) { try { built[p.key].output.disconnect(); } catch (e) {} }
    });
    var head = G.src;
    if (!bypassAll) {
      PEDALS.forEach(function (p) {
        if (!state[p.key].on) return;
        var n = pedalNode(p.key);
        head.connect(n.input);
        head = n.output;
      });
    }
    head.connect(G.out);
    chainText();
  }

  function chainText() {
    var names = PEDALS.filter(function (p) { return state[p.key].on && !bypassAll; })
                      .map(function (p) { return '<b style="color:' + p.color + '">' + p.name + '</b>'; });
    UI.el('pedal-chain').innerHTML = '🎸 Guitar → ' +
      (names.length ? names.join(' → ') + ' → ' : '') + '🔊 Output' +
      (bypassAll ? ' <span class="badge">ALL BYPASSED</span>' : '');
  }

  // ------------------------------------------------ sources
  function stopSustained() {
    if (susOsc) { try { susOsc.stop(); } catch (e) {} susOsc = null; susGain = null; }
    if (micNode) { try { micNode.disconnect(); } catch (e) {} micNode = null; }
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
  }

  var RIFF = [40, 40, 43, 40, 45, 43, 40, 47];
  function strike() {
    build();
    if (!Engine.ready()) return;
    var src = UI.el('pedal-src').value;
    var ctx = Engine.ctx, t0 = ctx.currentTime;

    if (src === 'saw' || src === 'sine') {
      if (susOsc) { stopSustained(); return; }
      susOsc = ctx.createOscillator();
      susOsc.type = src === 'saw' ? 'sawtooth' : 'sine';
      susOsc.frequency.value = src === 'saw' ? 110 : 220;
      susGain = Engine.gain(0.25);
      susOsc.connect(susGain); susGain.connect(G.src);
      susOsc.start();
      return;
    }
    if (src === 'mic') {
      if (!navigator.mediaDevices) return;
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } })
        .then(function (stream) {
          micStream = stream;
          micNode = ctx.createMediaStreamSource(stream);
          micNode.connect(G.src);
        }).catch(function () {});
      return;
    }

    var what = UI.el('pedal-note').value;
    var notes = what === 'chord' ? [40, 47, 52, 55, 59, 64]
              : what === 'power' ? [40, 47, 52]
              : what === 'single' ? [40] : null;
    if (notes) {
      notes.forEach(function (m, i) {
        Voices.play(G.src, src, Music.midiToFreq(m), { velocity: 0.5, when: t0 + i * 0.04 });
      });
    } else {
      RIFF.forEach(function (m, i) {
        Voices.play(G.src, src, Music.midiToFreq(m), { velocity: 0.55, when: t0 + i * 0.22 });
      });
    }
  }

  // ------------------------------------------------ board UI
  function makeBoard() {
    var board = UI.el('pedal-board');
    PEDALS.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'pedal';
      card.style.setProperty('--acc', p.color);
      var knobs = p.params.map(function (pr) {
        return '<div class="ctl"><label>' + pr.label +
          ' <span class="val" id="pd-' + p.key + '-' + pr.id + '-v"></span></label>' +
          '<input type="range" id="pd-' + p.key + '-' + pr.id + '" min="' + pr.min +
          '" max="' + pr.max + '" step="' + pr.step + '" value="' + pr.value + '"></div>';
      }).join('');
      card.innerHTML = '<h4><span class="dot"></span>' + p.name + '</h4>' +
        '<div class="sub">' + p.sub + '</div>' + knobs +
        '<button class="stomp" id="pd-' + p.key + '-stomp">ENGAGE</button>';
      card.title = p.desc;
      board.appendChild(card);

      p.params.forEach(function (pr) {
        UI.slider('pd-' + p.key + '-' + pr.id, function (v) {
          state[p.key].values[pr.id] = v;
          if (built[p.key]) built[p.key].set(pr.id, v);
        }, pr.fmt);
      });
      UI.el('pd-' + p.key + '-stomp').addEventListener('click', function () {
        build();
        state[p.key].on = !state[p.key].on;
        card.classList.toggle('on', state[p.key].on);
        this.textContent = state[p.key].on ? 'ON' : 'ENGAGE';
        rewire();
        xferNote();
      });
    });
  }

  // ------------------------------------------------ drawings
  function firstDrive() {
    for (var i = 0; i < PEDALS.length; i++) {
      var p = PEDALS[i];
      if (p.xfer && state[p.key].on && !bypassAll) return p;
    }
    return null;
  }

  function xferNote() {
    var p = firstDrive();
    UI.el('pedal-xfer-note').innerHTML = p
      ? '<b style="color:' + p.color + '">' + p.name + '.</b> ' + p.desc
      : 'Engage a drive pedal (Overdrive, Distortion, Fuzz, Octave Fuzz) to see how it bends the signal. A straight line means "what goes in comes out".';
  }

  function drawXfer() {
    var canvas = UI.el('pedal-xfer');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 4, 4);
    g.strokeStyle = 'rgba(93,104,128,.55)';
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.stroke();
    g.setLineDash([]);
    var p = firstDrive();
    var curve = p ? DSP.shaperCurve(p.xfer, state[p.key].values.drive) : DSP.shaperCurve('clean', 0);
    g.strokeStyle = p ? p.color : 'rgba(93,104,128,.8)';
    g.lineWidth = 2.2;
    g.beginPath();
    for (var i = 0; i < curve.length; i += 4) {
      var x = i / (curve.length - 1) * w;
      var y = h / 2 - curve[i] * h / 2 * 0.92;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  // ------------------------------------------------ boot
  function boot() {
    makeBoard();
    chainText();
    xferNote();

    UI.el('pedal-strum').addEventListener('click', strike);
    UI.el('pedal-loop').addEventListener('click', function () {
      if (loopTimer) { clearInterval(loopTimer); loopTimer = null; this.classList.remove('on'); }
      else { strike(); loopTimer = setInterval(strike, 2200); this.classList.add('on'); }
    });
    UI.el('pedal-bypass').addEventListener('click', function () {
      build();
      bypassAll = !bypassAll;
      this.classList.toggle('on', bypassAll);
      rewire();
      xferNote();
    });
    UI.el('pedal-src').addEventListener('change', stopSustained);

    Frame.add('pedals', function () {
      drawXfer();
      if (G) {
        Viz.scope(UI.el('pedal-scope'), G.dryTap, '#5d6880', { thin: true });
        Viz.scope(UI.el('pedal-scope'), G.wetTap, '#3ddbd9', { overlay: true });
        Viz.spectrum(UI.el('pedal-spec'), G.dryTap, '#5d6880', { lineOnly: true });
        Viz.spectrum(UI.el('pedal-spec'), G.wetTap, '#3ddbd9',
          { overlay: true, fill0: 'rgba(61,219,217,.04)', fill1: 'rgba(61,219,217,.35)' });
      } else {
        var c1 = Viz.fit(UI.el('pedal-scope')), c2 = Viz.fit(UI.el('pedal-spec'));
        Viz.bg(c1.g, c1.w, c1.h, 4, 8); Viz.bg(c2.g, c2.w, c2.h, 4, 8);
      }
    });
  }

  global.ViewPedals = { boot: boot };
})(window);
