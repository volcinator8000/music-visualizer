/* ============================================================
   keyboard.js — reusable piano keyboard widget.
   Two behaviours: 'momentary' (press = sound, release = stop) and
   'toggle' (click latches a note into a selection set).
   ============================================================ */
(function (global) {
  'use strict';

  var QWERTY = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };

  function create(container, opts) {
    opts = opts || {};
    var low = opts.low || 48, high = opts.high || 72;
    var mode = opts.mode || 'momentary';
    var selected = opts.selected || {};
    var keys = {};
    var pressed = {};
    var pointerDown = false;

    function build() {
      container.innerHTML = '';
      keys = {};
      var whites = [], m;
      for (m = low; m <= high; m++) if (!Music.isBlack(m)) whites.push(m);
      var ww = 100 / whites.length;
      var wi = 0;

      for (m = low; m <= high; m++) {
        var d = document.createElement('div');
        var black = Music.isBlack(m);
        d.className = 'key ' + (black ? 'b' : 'w');
        d.dataset.midi = m;
        if (black) {
          // sits between the previous and next white key
          d.style.left = (wi * ww - ww * 0.29) + '%';
          d.style.width = (ww * 0.58) + '%';
        } else {
          d.style.left = (wi * ww) + '%';
          d.style.width = ww + '%';
          wi++;
        }
        var lbl = document.createElement('div');
        lbl.className = 'lbl';
        lbl.textContent = (m % 12 === 0 || opts.labelAll) ? Music.midiName(m) : (black ? '' : Music.midiPitch(m));
        d.appendChild(lbl);
        container.appendChild(d);
        keys[m] = d;
      }
      paint();
    }

    function paint() {
      for (var m in keys) {
        var sel = selected[m] || pressed[m];
        keys[m].classList.toggle('sel', !!sel);
      }
    }

    function down(m) {
      if (mode === 'toggle') {
        if (selected[m]) delete selected[m]; else selected[m] = true;
        paint();
        if (opts.onChange) opts.onChange(list());
      } else {
        if (pressed[m]) return;
        pressed[m] = true;
        paint();
        if (opts.onDown) opts.onDown(m);
      }
    }

    function up(m) {
      if (mode === 'toggle') return;
      if (!pressed[m]) return;
      delete pressed[m];
      paint();
      if (opts.onUp) opts.onUp(m);
    }

    function allUp() { for (var m in pressed) up(+m); }

    function midiAt(ev) {
      var t = document.elementFromPoint(
        ev.clientX !== undefined ? ev.clientX : ev.touches[0].clientX,
        ev.clientY !== undefined ? ev.clientY : ev.touches[0].clientY);
      if (t && t.classList.contains('lbl')) t = t.parentNode;
      if (t && t.dataset && t.dataset.midi) return +t.dataset.midi;
      return null;
    }

    container.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      pointerDown = true;
      var m = midiAt(ev);
      if (m !== null) down(m);
    });
    container.addEventListener('pointermove', function (ev) {
      if (!pointerDown || mode === 'toggle') return;
      var m = midiAt(ev);
      for (var p in pressed) if (+p !== m) up(+p);
      if (m !== null) down(m);
    });
    global.addEventListener('pointerup', function () { pointerDown = false; allUp(); });
    global.addEventListener('pointercancel', function () { pointerDown = false; allUp(); });

    function list() {
      return Object.keys(selected).map(Number).sort(function (a, b) { return a - b; });
    }

    build();

    return {
      element: container,
      keys: function () { return keys; },
      selected: selected,
      list: list,
      setRange: function (lo, hi) { low = lo; high = hi; build(); },
      setSelection: function (arr) {
        for (var k in selected) delete selected[k];
        arr.forEach(function (m) { selected[m] = true; });
        paint();
        if (opts.onChange) opts.onChange(list());
      },
      clear: function () {
        for (var k in selected) delete selected[k];
        paint();
        if (opts.onChange) opts.onChange(list());
      },
      press: down,
      release: up,
      allUp: allUp,
      paint: paint,
      /* Bind the computer keyboard to this widget. baseGetter returns the
         MIDI note that the 'a' key should play. */
      bindQwerty: function (baseGetter, onShift) {
        var held = {};
        global.addEventListener('keydown', function (e) {
          if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
          if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
          var k = e.key.toLowerCase();
          if (k === 'z' || k === 'x') { if (onShift) onShift(k === 'z' ? -1 : 1); return; }
          if (!(k in QWERTY)) return;
          e.preventDefault();
          var m = baseGetter() + QWERTY[k];
          held[k] = m;
          down(m);
        });
        global.addEventListener('keyup', function (e) {
          var k = e.key.toLowerCase();
          if (held[k] !== undefined) { up(held[k]); delete held[k]; }
        });
      }
    };
  }

  global.Keyboard = { create: create, QWERTY: QWERTY };
})(window);
