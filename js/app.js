/* ============================================================
   app.js — power, master volume, tab routing, boot.
   ============================================================ */
(function (global) {
  'use strict';

  function setPower(on) {
    Engine.power(on);
    var btn = UI.el('power');
    btn.classList.toggle('on', on);
    UI.el('power-label').textContent = on ? 'Powered' : 'Power on';
  }

  /* Any "play" action anywhere implicitly powers the rig on — every view
     calls Engine.ready() from a click handler, which satisfies the browser
     autoplay policy. The header button then works as a master mute. */
  var origReady = Engine.ready.bind(Engine);
  Engine.ready = function () {
    if (!Engine.on) setPower(true);
    return origReady();
  };

  function boot() {
    UI.el('power').addEventListener('click', function () { setPower(!Engine.on); });
    UI.slider('master-vol', function (v) { Engine.setVolume(v); }, UI.pctFmt);

    var tabs = UI.el('tabs');
    tabs.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      Array.prototype.forEach.call(tabs.children, function (c) {
        c.classList.toggle('active', c === b);
      });
      var view = b.dataset.view;
      document.querySelectorAll('section.view').forEach(function (s) {
        s.classList.toggle('active', s.id === 'v-' + view);
      });
      Frame.setActive(view);
    });

    ViewInstruments.boot();
    ViewNotes.boot();
    ViewAmp.boot();
    ViewPedals.boot();
    ViewMath.boot();

    Frame.setActive('instruments');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})(window);
