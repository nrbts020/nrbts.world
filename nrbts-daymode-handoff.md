# nrbts.world — day-mode legibility fixes (v2: haze, not dark veil)

**Supersedes v1.** We're dropping the opaque dark scrim/veil from the first pass
— it made day mode too dark overall. Replace it with a light **haze/fog layer**
that provides contrast the same way real fog does: by sitting between the
viewer and the buildings, not by tinting the whole scene dark.

**Do not touch the night scene or the Three.js skyline geometry.** Everything
here is additive layers in day mode only.

Colors: teal `#74e0d0` / `#8fecdd`, coral `#e79079`, fog white `#ffffff` /
`rgba(238,244,248,·)`.

---

## 1. Replace the hero scrim with haze

Remove the old dark `.hero-scrim` radial/linear gradient entirely. Contrast for
the headline should now come from **fog density placed behind the text**, not
from an opaque dark layer over the whole hero. See section 2 for the fog
system — place denser puffs behind the headline's bounding box specifically
(e.g. a couple of larger, higher-opacity puffs centered around the text block),
rather than any full-bleed dark wash.

If the headline still needs a touch more contrast than fog alone gives, prefer
a subtle text-shadow (e.g. `0 2px 16px rgba(255,255,255,.4)` for dark-on-light
antialiasing, or a light `rgba(20,40,60,.25)` shadow if the text sits on a
brighter patch of sky) over any full-layer darkening.

## 2. Content sections — fog/haze layer instead of dark veil

Behind the projects / skills / contact content, replace `.content-veil` (the
flat `rgba(18,42,76,.28)` + blur wash) with **layered soft cloud puffs** that
sit in front of the buildings, pooled loosely around their bases and in the
gaps between towers — like fog banks in a skyline photo, not a tinted pane of
glass.

Approach (adjust to taste against the real scene):

```css
.fog-puff {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 72%);
  filter: blur(8px);
  pointer-events: none;
}
```

- Generate ~10–14 puffs of varying size (180–500px wide, flattened ~3:1
  width:height), opacity (.45–.65), and blur (7–11px), scattered at a couple of
  height bands between the towers — not one flat layer.
- This is the **4b "drifting haze pockets"** direction: wispy, threaded between
  buildings at varied heights, skyline still visible through the gaps. Keep the
  overall page value **light** — fog should read as atmosphere, not a dimmer.
- Text sitting over the fog gets its contrast from the fog itself (denser/more
  opaque puffs directly behind copy blocks) plus the existing glass card
  material (section 3) — not from any additional dark tint layer.

### Motion — fog moves independently from the buildings

The buildings already parallax with the mouse (existing behavior, unchanged).
Give the fog layer its **own, slower, eased drift** so the two layers read as
distinct depths rather than one clumsy layer moving together:

```js
// buildings: existing full-speed mouse parallax, unchanged
// fog: slower, eased, independent motion
const FOG_SPEED = 0.2;      // fraction of buildings' mouse-delta speed
const FOG_EASE_MS = 500;    // longer ease so fog feels like drift, not tracking

function updateFog(mouseX) {
  fogTargetX = mouseX * FOG_SPEED;
  // ease fogCurrentX toward fogTargetX over FOG_EASE_MS (e.g. lerp per frame,
  // or a CSS transition on transform if fog is a single translated container)
}
```

- Building layer: current behavior, no change.
- Fog layer: ~0.15–0.3x the buildings' mouse-delta speed, with a longer
  ease/lag (~400–600ms) so it visibly drifts rather than snapping to the
  cursor. Direction can match or invert the buildings' movement — try both,
  inverted reads slightly more natural for atmosphere vs. a rigid skyline.

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
- Please remove the old opaque dark scrim/veil from the previous pass — the
  haze is the contrast mechanism now, not a dark tint.
