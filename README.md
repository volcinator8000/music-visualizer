# 🎛️ Harmonic Workshop — music visualizer

An interactive audio workshop that runs entirely in the browser: **see what you hear**.
Built with the Web Audio API and a `<canvas>` — no frameworks, no build step, no servers.

**Live site:** https://volcinator8000.github.io/music-visualizer/

## What's inside

| View | What it shows |
|---|---|
| **Instruments** | Guitar (Karplus–Strong string model), bass, piano, violin, flute, trumpet, organ and raw waveforms — play them on a keyboard and compare waveform, spectrum and harmonic fingerprint. |
| **Notes & Chords** | Build any chord, hear it, and see interval ratios, beating, a Lissajous consonance plot, the combined interference waveform and every position on a guitar fretboard. |
| **Amp & EQ** | Gain vs master, tube/solid-state/fuzz clipping, a real tone stack (bass/mid/treble/presence) and cabinet sim — with the live EQ frequency-response curve and preamp transfer curve plotted from the actual audio nodes. |
| **Pedalboard** | Compressor, auto-wah, overdrive, distortion, fuzz, octave fuzz, chorus, phaser, tremolo, delay and reverb — all from native Web Audio nodes, with dry/wet waveform and spectrum comparison. |
| **Math Mode** | Sum arbitrary sine partials sample-by-sample and run a hand-written radix-2 FFT over the result (windows, leakage, peak interpolation) · two-source **noise cancelling in 2D** with draggable sources, nodal lines and a listener you can hear · sampling, aliasing and quantisation. |

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Any static file server works; opening `index.html` directly from disk works too.)

## Hosting

Served by **GitHub Pages** straight from the repo root of `main` — no build step.
