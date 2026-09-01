/* ============================================================
   view-instruments.js — pick an instrument, play it, and see why
   it sounds the way it does.
   ============================================================ */
(function (global) {
  'use strict';

  var current = 'acoustic';
  var bus = null, analyser = null;
  var active = {};          // midi -> voice handle
  var kb, octShift = 0, velocity = 0.8;
  var lastMidi = 57;

  /* Display-only harmonic profiles for the physically-modelled strings
     (their real spectrum comes from the pluck buffer, not a table). */
  var PLUCK_PROFILE = {
    acoustic: [1, .72, .55, .42, .3, .22, .16, .11, .08, .05, .04, .03],
    electric: [1, .8, .5, .3, .18, .1, .06, .04, .02, .015, .01, .008],
    bass:     [1, .6, .38, .2, .1, .05, .025, .012, .006, .003, .002, .001]
  };

  function ensureGraph() {
    if (bus) return;
    Engine.init();
    bus = Engine.gain(0.9);
    analyser = Engine.analyser(4096, 0.55);
    bus.connect(analyser);
    analyser.connect(Engine.master);
  }

  function def() { return Voices.defs[current]; }

  function noteOn(midi) {
    ensureGraph();
    if (!Engine.ready()) return;
    var d = def();
    var m = Math.min(d.range[1], Math.max(d.range[0], midi + octShift * 12));
    lastMidi = m;
    if (active[midi]) active[midi].release();
    active[midi] = Voices.play(bus, current, Music.midiToFreq(m), { velocity: velocity });
    facts(m);
  }
  function noteOff(midi) {
    if (active[midi]) { active[midi].release(); delete active[midi]; }
  }

  function facts(m) {
    var f = Music.midiToFreq(m), d = def();
    var rows = [
      ['Note', Music.midiName(m)],
      ['Fundamental', f.toFixed(2) + ' Hz'],
      ['Period', (1000 / f).toFixed(2) + ' ms'],
      ['Wavelength in air', (343 / f).toFixed(2) + ' m'],
      ['Synthesis', d.kind === 'pluck' ? 'Karplus–Strong string' : 'Additive (' + d.harmonics.length + ' partials)'],
      ['Envelope', d.sustain ? 'sustains while held' : 'natural decay']
    ];
    UI.el('inst-facts').innerHTML = rows.map(function (r) {
      return '<div class="kv"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');
  }

  function pickInstrument(key) {
    current = key;
    var d = def();
    UI.el('inst-desc').innerHTML = '<b style="color:' + d.color + '">' + d.name + '.</b> ' + d.desc;
    var chips = UI.el('inst-list').children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', chips[i].dataset.key === key);
    }
    facts(lastMidi);
  }

  function drawHarmonics() {
    var canvas = UI.el('inst-harm');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 4, 1);
    var d = def();
    var hs = d.kind === 'pluck' ? PLUCK_PROFILE[current] : d.harmonics;
    if (!hs) return;
    var n = Math.max(hs.length, 12);
    var bw = w / n;
    var max = Math.max.apply(null, hs) || 1;
    for (var i = 0; i < hs.length; i++) {
      var v = hs[i] / max;
      var bh = v * (h - 26);
      g.fillStyle = i === 0 ? '#ffb347' : 'rgba(61,219,217,' + (0.35 + 0.65 * v) + ')';
      g.fillRect(i * bw + bw * 0.18, h - 14 - bh, bw * 0.64, bh);
      g.fillStyle = 'rgba(93,104,128,.9)';
      g.font = '9px ui-monospace,monospace';
      g.textAlign = 'center';
      g.fillText(i + 1, i * bw + bw / 2, h - 3);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(142,153,176,.8)';
    g.font = '700 9px ui-monospace,monospace';
    g.fillText('harmonic number →  (1 = fundamental)', 8, 12);
  }

  // ------------------------------------------------ demo material
  var demoTimer = null;
  function stopDemo() { if (demoTimer) { clearInterval(demoTimer); demoTimer = null; } }

  function playDemo() {
    ensureGraph();
    if (!Engine.ready()) return;
    stopDemo();
    var d = def();
    var root = Math.max(d.range[0] + 7, Math.min(d.range[1] - 12, 52 + octShift * 12));
    var line = [0, 3, 5, 7, 10, 7, 5, 3, 0, -2, 0, 3].map(function (s) { return root + s; });
    var i = 0;
    demoTimer = setInterval(function () {
      if (i >= line.length) { stopDemo(); return; }
      var m = line[i++];
      lastMidi = m;
      Voices.play(bus, current, Music.midiToFreq(m),
        { velocity: velocity, duration: d.sustain ? 0.24 : undefined });
      facts(m);
    }, 280);
  }

  function strumChord() {
    ensureGraph();
    if (!Engine.ready()) return;
    var d = def();
    var root = Math.max(d.range[0], Math.min(d.range[1] - 16, 52 + octShift * 12));
    [0, 7, 12, 16, 19].forEach(function (iv, i) {
      var m = root + iv;
      if (m > d.range[1]) return;
      Voices.play(bus, current, Music.midiToFreq(m),
        { velocity: velocity * 0.8, when: Engine.ctx.currentTime + i * 0.045,
          duration: d.sustain ? 1.6 : undefined });
    });
    lastMidi = root;
    facts(root);
  }

  // ------------------------------------------------ boot
  function boot() {
    var list = UI.el('inst-list');
    Voices.keys.forEach(function (k) {
      var b = document.createElement('button');
      b.className = 'btn sm';
      b.dataset.key = k;
      b.textContent = Voices.defs[k].name;
      b.style.setProperty('--acc', Voices.defs[k].color);
      b.addEventListener('click', function () { pickInstrument(k); });
      list.appendChild(b);
    });

    kb = Keyboard.create(UI.el('inst-keys'), {
      low: 48, high: 76, mode: 'momentary',
      onDown: noteOn, onUp: noteOff
    });
    kb.bindQwerty(function () { return 57; }, function (dir) {
      octShift = Math.max(-2, Math.min(2, octShift + dir));
      UI.el('inst-oct').value = octShift;
      UI.el('inst-oct-v').textContent = octShift > 0 ? '+' + octShift : octShift;
    });

    UI.slider('inst-oct', function (v) { octShift = v; }, function (v) { return v > 0 ? '+' + v : v; });
    UI.slider('inst-vel', function (v) { velocity = v; }, UI.pctFmt);
    UI.el('inst-demo').addEventListener('click', playDemo);
    UI.el('inst-chord').addEventListener('click', strumChord);

    pickInstrument(current);
    facts(lastMidi);

    Frame.add('instruments', function () {
      drawHarmonics();
      if (!analyser) {
        var c1 = Viz.fit(UI.el('inst-scope')), c2 = Viz.fit(UI.el('inst-spec'));
        Viz.bg(c1.g, c1.w, c1.h, 4, 8); Viz.bg(c2.g, c2.w, c2.h, 4, 8);
        return;
      }
      Viz.scope(UI.el('inst-scope'), analyser, def().color, { span: 1400 });
      Viz.spectrum(UI.el('inst-spec'), analyser, def().color);
    });
  }

  global.ViewInstruments = { boot: boot };
})(window);
