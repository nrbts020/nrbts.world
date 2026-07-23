# nrbts.world — day-mode legibility fixes

Three targeted changes. **Do not touch the night scene or the Three.js skyline
geometry / parallax.** Everything here is a CSS overlay on the content layer, so
it stays anchored to the text while the skyline parallaxes underneath.

Colors used below match the existing palette (teal `#74e0d0`, coral `#e79079`,
dark blue-ink `#0e1116` / `rgba(6,18,34,·)`).

---

## 1. Hero — editorial scrim (day mode only)

The white headline currently has almost no contrast against the light day sky.
Add a single darkening layer **above the skyline, below the text**. Because it
lives on the content layer, it does not move with the parallax.

```css
.hero-scrim {            /* absolutely positioned, fills the hero, day mode only */
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(150% 110% at -5% 105%,
      rgba(6,18,34,.78) 0%,
      rgba(6,18,34,.50) 26%,
      rgba(6,18,34,.18) 48%,
      rgba(6,18,34,0)  66%),
    linear-gradient(0deg, rgba(6,18,34,.35) 0%, rgba(6,18,34,0) 16%);
}
```

- The radial wash sits behind the bottom-left headline; the second linear
  gradient seats the bottom toggle bar.
- Fade `.hero-scrim` opacity to 0 as the scene transitions to night (night
  already has contrast and doesn't need it).
- Keep the eyebrow / "spatial design" accent a touch brighter teal on day:
  `#8fecdd` reads better than `#74e0d0` over the wash.

## 2. Content sections — push the skyline back (light recede)

Behind the projects / skills / contact content, add a veil layer between the
skyline and the content so the buildings frame rather than compete.

```css
.content-veil {         /* fixed, behind content, above skyline */
  position: fixed;
  inset: 0;
  z-index: 1;           /* skyline below, content above */
  pointer-events: none;
  background: rgba(18,42,76,.28);
  backdrop-filter: blur(2.5px);
  -webkit-backdrop-filter: blur(2.5px);
}
```

- This is the **light recede** option (blur 2.5 / wash .28) — keeps the skyline
  present but quiet.
- Optional polish: ramp the alpha from ~.12 to ~.28 as the user scrolls past the
  hero (tie to scroll progress), so the skyline is vivid at the top and calms
  under the reading content.

## 3. One card / panel material

Project cards, the Serial Mag block, and the about + experience panels currently
use three different backgrounds. Unify them:

```css
.glass {
  background: rgba(248,251,254,.84);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,.72);
  box-shadow: 0 22px 50px -26px rgba(8,24,48,.6);
  clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%);
}
```

Text on `.glass`: title `#1a2430`, metadata `#159e8b` (darker teal for contrast
on the light fill), body `#4a5560`.

---

## Notes
- `backdrop-filter` needs the `-webkit-` prefix for Safari; test there.
- These were prototyped against a CSS stand-in skyline, so nudge blur/opacity to
  taste against the real Three.js render.
