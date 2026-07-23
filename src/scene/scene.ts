import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createSkyDome, dayFactor, hoursOf } from './sky';
import { createCityLayers, attachPointerTracking } from './city';
import { createGroundHaze } from './haze';
import { createMountain } from './mountain';

/**
 * Stage 3: day/night sky gradient dome (see ./sky.ts), driven by local
 * clock time.
 *
 * Stage 5: parallax city layers (see ./city.ts), day-state only.
 *
 * Stage 7: bloom via EffectComposer + UnrealBloomPass. The bloom
 * threshold isolates real neon (the city's HDR emissive layer, see
 * ./city.ts) from ordinary lit surfaces because only the emissive layer
 * is allowed to exceed 1.0 — plain white daytime buildings and the sky
 * never do, so they never glow, only actual lights do. Kept deliberately
 * light (halved internal resolution, modest strength/radius) per the
 * mobile-performance requirement — this is the only postprocessing pass
 * this scene will carry.
 *
 * Stage 9: manual sun/moon override for demoing, since renamed in spirit
 * to just a time-of-day override once the moon itself was removed (see
 * below) — a small UI control (see index.astro) can still pin the scene
 * to "day" or "night" instead of the real clock.
 *
 * Moon removal (post-Stage-9 feedback): Stages 2/4 originally rendered a
 * real, SunCalc-positioned, phase-accurate 3D moon here. Once the city
 * reached its current bold, high-contrast style, the realistic moon read
 * as visually out of place next to it, so it's been removed along with
 * its dedicated PBR material, textures, and the "sun" directional/ambient
 * lights that existed only to light it — nothing else in the scene reads
 * three.js lighting (the sky and city are both fully self-shaded shader
 * quads). ./moon-astronomy.ts and outputs/gen_moon_textures.py are left
 * in place, unused, in case a stylized version is worth revisiting later.
 */
export type TimeOverride = 'live' | 'day' | 'night';

export interface SceneHandle {
  dispose: () => void;
  setTimeOverride: (mode: TimeOverride) => void;
}

export function initScene(canvas: HTMLCanvasElement): SceneHandle {
  const scene = new THREE.Scene();

  const sky = createSkyDome();
  sky.update(new Date());
  scene.add(sky.mesh);

  // Distant Fuji/Hood silhouette — the single farthest layer, drawn just
  // above the sky and behind every building (see ./mountain.ts).
  const mountain = createMountain();
  scene.add(mountain.mesh);

  const camera = new THREE.PerspectiveCamera(
    45,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 6);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // ACES tone mapping is what makes the HDR emissive boost in ./city.ts
  // mean anything visually — without it, values above 1.0 just clip to
  // flat white instead of rolling off into a bright, glowing highlight.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const city = createCityLayers();
  scene.add(city.group);
  const detachPointerTracking = attachPointerTracking();

  // Lighting mood pass: cold ground haze drawn over the whole skyline,
  // diffusing the city's window glow (see ./haze.ts).
  const haze = createGroundHaze();
  scene.add(haze.mesh);

  // Bloom: rendered at half resolution (mobile-conscious — this is the
  // most expensive thing in the whole scene, so it's the one place worth
  // spending the render-cost budget on).
  //
  // Threshold must sit ABOVE the brightest ordinary (non-emissive) surface
  // in the scene, or it blooms things that were never meant to glow. Day
  // city bodies render at up to ~0.94-0.96 brightness and night's own
  // literal lit-window color (before the emissive boost) sits around
  // ~0.92 — both comfortably non-HDR. The city shader's emissive layer
  // (see ./city.ts) is deliberately boosted by uBloomStrength so real
  // neon pixels land north of ~2.5, way past either of those. A threshold
  // of 0.9 sat inside the day city's own brightness range, so the entire
  // white daytime skyline itself bloomed into a wide fog — a real bug,
  // not a stylistic choice. 1.15 clears every ordinary surface (day
  // buildings, unboosted night windows) while still easily catching the
  // boosted emissive layer.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth / 2, canvas.clientHeight / 2),
    1.1, // strength — punchier windows
    0.18, // radius — tight falloff so points stay crisp instead of hazing together
    1.15 // threshold — safely above ordinary (non-emissive) scene brightness
  );
  composer.addPass(bloomPass);

  let running = true;

  // Stage 9: override state. "day"/"night" pin the virtual clock to a
  // fixed hour on today's real date (13:00 is comfortably mid-afternoon
  // past dawn/dusk transitions; 01:00 is comfortably past dusk) so the
  // sky/city cross-fade lands fully in one state, not mid-transition.
  let timeOverride: TimeOverride = 'live';

  function getEffectiveDate(): Date {
    if (timeOverride === 'live') return new Date();
    const d = new Date();
    d.setHours(timeOverride === 'day' ? 13 : 1, 0, 0, 0);
    return d;
  }

  function setTimeOverride(mode: TimeOverride) {
    timeOverride = mode;
    // Apply immediately rather than waiting for the next once-a-second
    // clock tick, so the toggle feels instant when demoing.
    const date = getEffectiveDate();
    currentDayFactor = dayFactor(hoursOf(date));
    updateFromClock(date);
  }

  function resize() {
    const { clientWidth, clientHeight } = canvas;
    const aspect = clientWidth / clientHeight;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight, false);
    composer.setSize(clientWidth, clientHeight);
    bloomPass.setSize(clientWidth / 2, clientHeight / 2);
    // Mobile aspect-ratio fix: re-derive the city's per-layer horizontal
    // zoom and the sky's aspect-corrected star/band math for the new
    // viewport shape (see city.ts and sky.ts) — without this, narrow/tall
    // viewports squeeze the fixed-aspect city art into less width than it
    // was authored for.
    city.resize(aspect);
    sky.resize(aspect);
    mountain.resize(aspect);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  // ResizeObserver's callback does fire once shortly after observe(), but
  // call resize() synchronously too so the very first frame is already
  // aspect-correct instead of flashing the unstretched default for a beat.
  resize();

  function updateFromClock(date: Date) {
    sky.update(date);
  }
  updateFromClock(getEffectiveDate());

  let lastClockUpdate = 0;
  const CLOCK_UPDATE_INTERVAL_MS = 1000;
  let lastFrameTime = 0;
  let currentDayFactor = dayFactor(hoursOf(getEffectiveDate()));
  let elapsedTime = 0;

  function tick(now: number) {
    if (!running) return;

    const dtSeconds = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.1) : 0;
    lastFrameTime = now;
    elapsedTime += dtSeconds;

    if (now - lastClockUpdate > CLOCK_UPDATE_INTERVAL_MS) {
      const date = getEffectiveDate();
      currentDayFactor = dayFactor(hoursOf(date));
      updateFromClock(date);
      lastClockUpdate = now;
    }

    // Parallax needs to feel smooth every frame, unlike the once-a-second
    // clock-driven sky update above. The day factor itself only changes
    // once a second, but re-sending it every frame is free and keeps the
    // city's cross-fade shader in lockstep with the sky.
    city.update(dtSeconds, currentDayFactor);
    mountain.update(currentDayFactor);
    // Milky Way animation (star twinkle, haze drift) needs a smooth running
    // clock too, independent of the once-a-second color update.
    sky.updateTime(elapsedTime);
    haze.update(1 - currentDayFactor);

    composer.render();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function dispose() {
    running = false;
    resizeObserver.disconnect();
    detachPointerTracking();
    sky.dispose();
    city.dispose();
    mountain.dispose();
    haze.dispose();
    bloomPass.dispose();
    composer.dispose();
    renderer.dispose();
  }

  return { dispose, setTimeOverride };
}
