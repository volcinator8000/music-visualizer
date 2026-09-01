/* ============================================================
   view-notes.js — chords, intervals, consonance, beating,
   Lissajous figures and the guitar fretboard.
   ============================================================ */
(function (global) {
  'use strict';

  var INTERVALS = [
    ['Unison', '1:1'], ['Minor 2nd', '16:15'], ['Major 2nd', '9:8'],
    ['Minor 3rd', '6:5'], ['Major 3rd', '5:4'], ['Perfect 4th', '4:3'],
    ['Tritone', '45:32'], ['Perfect 5th', '3:2'], ['Minor 6th', '8:5'],
    ['Major 6th', '5:3'], ['Minor 7th', '16:9'], ['Major 7th', '15:8'],
    ['Octave', '2:1']
  ];
  var CHORDS = {
    'maj':   { name: 'Major', iv: [0, 4, 7],        note: 'Root, major 3rd, perfect 5th — ratios close to 4:5:6, the most consonant triad. The shared harmonics line up, so the spectrum looks orderly.' },
    'min':   { name: 'Minor', iv: [0, 3, 7],        note: 'The 3rd drops a semitone (ratio 6:5). Still consonant, but the harmonic alignment is slightly weaker — the familiar "darker" colour.' },
    'power': { name: 'Power chord (5)', iv: [0, 7], note: 'Just root + fifth (3:2). No 3rd means no major/minor identity — and under heavy distortion the missing 3rd is exactly why power chords stay clean-sounding while full triads turn to mud.' },
    'dom7':  { name: 'Dominant 7th', iv: [0, 4, 7, 10], note: 'A major triad plus a minor 7th. The tritone between the 3rd and 7th makes it restless — it wants to resolve.' },
    'maj7':  { name: 'Major 7th', iv: [0, 4, 7, 11], note: 'The 7th sits one semitone below the octave — a gentle, jazzy shimmer of slow beating against the root’s harmonics.' },
    'min7':  { name: 'Minor 7th', iv: [0, 3, 7, 10], note: 'Minor triad plus minor 7th; smooth because every interval in the stack is at least a minor 3rd.' },
    'dim':   { name: 'Diminished', iv: [0, 3, 6],   note: 'Stacked minor 3rds; the outer interval is a tritone. Watch the Lissajous curve refuse to settle.' },
    'aug':   { name: 'Augmented', iv: [0, 4, 8],    note: 'Stacked major 3rds. Perfectly symmetric, so the ear cannot decide which note is the root.' },
    'sus4':  { name: 'Sus4', iv: [0, 5, 7],         note: 'The 3rd is replaced by the 4th — a 4:3 clash a whole step below the 5th that resolves beautifully back to major.' },
    'sus2':  { name: 'Sus2', iv: [0, 2, 7],         note: 'Open and ambiguous; the 2nd beats gently against the root.' },
    'dim7':  { name: 'Diminished 7th', iv: [0, 3, 6, 9], note: 'Four minor 3rds — divides the octave exactly into 4. Every inversion is the same chord.' },
    'add9':  { name: 'Add 9', iv: [0, 4, 7, 14],    note: 'A major triad with the 9th on top for sparkle — chimey because the 9th is a low, simple 9:4 against the root.' },
    'octaves': { name: 'Octaves', iv: [0, 12],      note: '2:1 — the simplest possible ratio. The upper note’s every harmonic already exists in the lower note, so they fuse into one sound.' },
    'tritone': { name: 'Tritone', iv: [0, 6],       note: '45:32 — the most complex ratio in the scale. Maximum roughness; the medieval "diabolus in musica".' }
  };

  var bus = null, analyser = null;
  var kb, voice = 'piano';
  var handles = [];
  var lissPhase = 0;

  function ensureGraph() {
    if (bus) return;
    Engine.init();
    bus = Engine.gain(0.9);
    analyser = Engine.analyser(4096, 0.6);
    bus.connect(analyser);
    analyser.connect(Engine.master);
  }

  function selection() { return kb ? kb.list() : []; }

  function stopAll() {
    handles.forEach(function (h) { try { h.release(); } catch (e) {} });
    handles = [];
  }

  function soundIt(arp) {
    ensureGraph();
    if (!Engine.ready()) return;
    stopAll();
    var sel = selection();
    var d = Voices.defs[voice];
    sel.forEach(function (m, i) {
      var when = Engine.ctx.currentTime + (arp ? i * 0.34 : i * 0.02);
      handles.push(Voices.play(bus, voice, Music.midiToFreq(m), {
        velocity: 0.75 / Math.sqrt(Math.max(1, arp ? 1 : sel.length * 0.5)),
        when: when,
        duration: d.sustain ? (arp ? 0.55 : 2.4) : undefined
      }));
    });
  }

  // ------------------------------------------------ analysis panels
  function analyse() {
    var sel = selection();
    UI.el('notes-sel').textContent = sel.length
      ? sel.map(Music.midiName).join(' · ') : '—';

    // interval table (each note against the lowest)
    var t = UI.el('notes-table');
    if (sel.length < 2) {
      t.innerHTML = '<tr><td style="color:var(--txt-faint)">Select two or more notes to analyse the intervals between them.</td></tr>';
    } else {
      var root = sel[0], rf = Music.midiToFreq(root);
      var html = '<tr><th>Note</th><th>vs ' + Music.midiName(root) +
                 '</th><th>Ratio ≈</th><th>Freq</th><th>Beat vs root</th></tr>';
      sel.slice(1).forEach(function (m) {
        var s = m - root, f = Music.midiToFreq(m);
        var iv = INTERVALS[s % 12 === 0 && s > 0 ? 12 : s % 12];
        var name = s > 12 ? iv[0] + ' +' + Math.floor(s / 12) + ' oct' : iv[0];
        html += '<tr><td class="n">' + Music.midiName(m) + '</td><td>' + name +
          ' (' + s + ' st)</td><td>' + iv[1] + '</td><td>' + f.toFixed(1) +
          ' Hz</td><td>' + Math.abs(f - rf).toFixed(1) + ' Hz</td></tr>';
      });
      t.innerHTML = html;
    }

    // consonance blurb: match against known chord shapes
    var blurb = '';
    if (sel.length >= 2) {
      var shape = sel.map(function (m) { return m - sel[0]; });
      for (var k in CHORDS) {
        if (CHORDS[k].iv.join() === shape.join()) {
          blurb = '<b>' + Music.midiPitch(sel[0]) + ' ' + CHORDS[k].name + '.</b> ' + CHORDS[k].note;
          break;
        }
      }
      if (!blurb) blurb = 'Custom voicing — ' + sel.length +
        ' notes. Simpler frequency ratios ⇒ more aligned harmonics ⇒ smoother sound.';
    }
    UI.el('notes-consonance').innerHTML = blurb;
  }

  // ------------------------------------------------ computed drawings
  function drawBeat() {
    var canvas = UI.el('notes-beat');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 2, 8);
    var sel = selection();
    if (!sel.length) return;
    var freqs = sel.map(Music.midiToFreq);
    var T = 0.35;                       // seconds shown
    g.strokeStyle = '#ff6b9d';
    g.lineWidth = 1.4;
    g.beginPath();
    var N = Math.min(w * 2, 1400);
    for (var i = 0; i < N; i++) {
      var t = (i / N) * T, s = 0;
      for (var j = 0; j < freqs.length; j++) s += Math.sin(2 * Math.PI * freqs[j] * t);
      s /= freqs.length;
      var x = (i / N) * w, y = h / 2 - s * h * 0.44;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    if (freqs.length >= 2) {
      var beat = Math.abs(freqs[1] - freqs[0]);
      g.fillStyle = 'rgba(231,236,245,.85)';
      g.font = '700 10px ui-monospace,monospace';
      g.fillText('lowest pair beats at ' + beat.toFixed(1) + ' Hz  ·  window = 350 ms', 8, 13);
    }
  }

  function drawLissajous() {
    var canvas = UI.el('notes-liss');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    Viz.bg(g, w, h, 4, 4);
    var sel = selection();
    if (sel.length < 2) {
      g.fillStyle = 'rgba(93,104,128,.8)';
      g.font = '11px ui-monospace,monospace';
      g.fillText('needs two notes', 10, 20);
      return;
    }
    var f1 = Music.midiToFreq(sel[0]), f2 = Music.midiToFreq(sel[1]);
    var r = Math.min(w, h) * 0.42, cx = w / 2, cy = h / 2;
    lissPhase += 0.006;
    g.strokeStyle = '#a78bfa';
    g.lineWidth = 1.6;
    g.beginPath();
    var N = 900, base = Math.min(f1, f2);
    for (var i = 0; i <= N; i++) {
      var t = i / N * (8 / base);       // several periods of the slower note
      var x = cx + Math.sin(2 * Math.PI * f1 * t) * r;
      var y = cy + Math.sin(2 * Math.PI * f2 * t + lissPhase) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(142,153,176,.9)';
    g.font = '700 10px ui-monospace,monospace';
    g.fillText(Music.midiName(sel[0]) + ' vs ' + Music.midiName(sel[1]) +
      '  ·  ratio ' + (f2 / f1).toFixed(3), 8, h - 8);
  }

  var TUNING = [64, 59, 55, 50, 45, 40];   // high E to low E, top string drawn first
  function drawFretboard() {
    var canvas = UI.el('notes-fret');
    var f = Viz.fit(canvas), g = f.g, w = f.w, h = f.h;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0c0905';
    g.fillRect(0, 0, w, h);
    var frets = 15, pad = 26, top = 18, bottom = 16;
    var fw = (w - pad - 8) / frets;
    var sh = (h - top - bottom) / 5;
    var sel = selection();
    var classes = {}, rootClass = sel.length ? ((sel[0] % 12) + 12) % 12 : -1;
    sel.forEach(function (m) { classes[((m % 12) + 12) % 12] = true; });

    // frets
    for (var fr = 0; fr <= frets; fr++) {
      var x = pad + fr * fw;
      g.strokeStyle = fr === 0 ? '#d9c9a3' : 'rgba(180,160,120,.35)';
      g.lineWidth = fr === 0 ? 4 : 1.5;
      g.beginPath(); g.moveTo(x, top - 6); g.lineTo(x, h - bottom + 6); g.stroke();
      if ([3, 5, 7, 9, 12, 15].indexOf(fr) >= 0 && fr > 0) {
        g.fillStyle = 'rgba(217,201,163,.3)';
        var mx = pad + (fr - 0.5) * fw;
        if (fr === 12) {
          g.beginPath(); g.arc(mx, top + sh * 1.5, 3.5, 0, 7); g.fill();
          g.beginPath(); g.arc(mx, top + sh * 3.5, 3.5, 0, 7); g.fill();
        } else {
          g.beginPath(); g.arc(mx, h / 2, 3.5, 0, 7); g.fill();
        }
        g.fillStyle = 'rgba(142,153,176,.7)';
        g.font = '9px ui-monospace,monospace';
        g.textAlign = 'center';
        g.fillText(fr, mx, h - 3);
        g.textAlign = 'left';
      }
    }
    // strings + dots
    for (var s = 0; s < 6; s++) {
      var y = top + s * sh;
      g.strokeStyle = 'rgba(200,205,215,' + (0.35 + s * 0.06) + ')';
      g.lineWidth = 0.8 + s * 0.35;
      g.beginPath(); g.moveTo(pad, y); g.lineTo(w - 8, y); g.stroke();
      g.fillStyle = 'rgba(142,153,176,.8)';
      g.font = '9px ui-monospace,monospace';
      g.fillText(Music.midiPitch(TUNING[s]), 6, y + 3);
      for (fr = 0; fr <= frets; fr++) {
        var pc = ((TUNING[s] + fr) % 12 + 12) % 12;
        if (!classes[pc]) continue;
        var dx = fr === 0 ? pad - 12 : pad + (fr - 0.5) * fw;
        g.beginPath();
        g.arc(dx, y, 7, 0, 7);
        g.fillStyle = pc === rootClass ? '#ffb347' : '#3ddbd9';
        g.fill();
        g.fillStyle = '#10131a';
        g.font = '700 8px ui-monospace,monospace';
        g.textAlign = 'center';
        g.fillText(Music.NAMES[pc], dx, y + 2.6);
        g.textAlign = 'left';
      }
    }
  }

  // ------------------------------------------------ boot
  function boot() {
    var rootSel = UI.el('chord-root');
    Music.NAMES.forEach(function (n, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = n;
      rootSel.appendChild(o);
    });
    rootSel.value = 4;   // E, for the guitarists

    var typeSel = UI.el('chord-type');
    Object.keys(CHORDS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = CHORDS[k].name;
      typeSel.appendChild(o);
    });

    var instSel = UI.el('notes-inst');
    Voices.keys.forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = Voices.defs[k].name;
      instSel.appendChild(o);
    });
    instSel.value = voice;
    instSel.addEventListener('change', function () { voice = instSel.value; });

    kb = Keyboard.create(UI.el('notes-keys'), {
      low: 41, high: 77, mode: 'toggle',
      onChange: analyse
    });

    function applyChord() {
      var root = 12 * (+UI.el('chord-oct').value + 1) + +rootSel.value;
      kb.setSelection(CHORDS[typeSel.value].iv.map(function (i) { return root + i; }));
    }
    rootSel.addEventListener('change', function () { applyChord(); soundIt(false); });
    typeSel.addEventListener('change', function () { applyChord(); soundIt(false); });
    UI.slider('chord-oct', applyChord);

    UI.el('notes-play').addEventListener('click', function () { soundIt(false); });
    UI.el('notes-arp').addEventListener('click', function () { soundIt(true); });
    UI.el('notes-clear').addEventListener('click', function () { stopAll(); kb.clear(); });

    applyChord();
    analyse();

    Frame.add('notes', function () {
      drawBeat();
      drawLissajous();
      drawFretboard();
      if (analyser) {
        Viz.scope(UI.el('notes-scope'), analyser, '#7bd88f', { span: 2600 });
        Viz.spectrum(UI.el('notes-spec'), analyser, '#7bd88f',
          { fill0: 'rgba(123,216,143,.05)', fill1: 'rgba(123,216,143,.4)' });
      } else {
        var c1 = Viz.fit(UI.el('notes-scope')), c2 = Viz.fit(UI.el('notes-spec'));
        Viz.bg(c1.g, c1.w, c1.h, 4, 8); Viz.bg(c2.g, c2.w, c2.h, 4, 8);
      }
    });
  }

  global.ViewNotes = { boot: boot };
})(window);
