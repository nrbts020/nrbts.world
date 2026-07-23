import * as THREE from 'three';

/**
 * Stage 5: parallax city layers. Flat 2.5D art, NOT 3D geometry — three
 * procedurally generated silhouette strips (far/mid/near) rendered as
 * camera-independent screen-space quads, same trick as ./sky.ts, anchored
 * to the bottom of the viewport. Depth comes purely from parallax drift
 * speed + band height/tone per layer, not from real geometry.
 *
 * Stage 6: each layer now has a day AND night texture (see
 * outputs/gen_city_layers.py — the building layout is generated once and
 * shared by both renders, so silhouettes never shift/ghost during the
 * cross-fade, only color/lighting does). The fragment shader mixes them
 * per-pixel via uDayFactor, the same clock-driven value driving the sky
 * gradient in ./sky.ts, so the city and sky always agree on time of day.
 * Night art: near-black bodies, sparse cyan-dominant lit windows with
 * rare red, soft roofline glow.
 *
 * Mobile note: parallax responds to touch drag as well as mouse move
 * (see attachPointerTracking) — this must stay true for every later
 * addition, per explicit design constraint.
 *
 * Lighting mood pass (post-launch feedback, referencing Wong Kar-wai's
 * Fallen Angels): the original cyan-dominant night glow read too close to
 * a generic "cyberpunk neon" palette. Recolored to a cold white/grey window
 * glow with a gentle per-layer pulse (see FRAGMENT_SHADER), paired with a
 * separate ground-haze layer (./haze.ts) tinted with the sky's own daytime
 * blue so night and day read as the same world. The one exception is the
 * near layer's Nagoya TV Tower landmark (baked into city_near_*.png), whose
 * red aviation beacon stays the single deliberate color break from the cold
 * palette.
 *
 * Mobile aspect-ratio fix (post-launch feedback): these are screen-space
 * quads with no camera, so the vertex shader always stretches `vUv` (0..1)
 * across the FULL canvas width and the layer's FULL band height, whatever
 * the canvas's aspect ratio is. The source art (see outputs/gen_city_layers.py)
 * is a fixed 3600x900 (4:1) raster. On a narrow/tall mobile viewport this
 * meant the same texture content got squeezed into far less physical width
 * than on desktop while the band height stayed a normal fraction of a much
 * taller screen — buildings visibly distorted/squeezed together rather than
 * just showing fewer of them. Fixed by scaling the sampled U window
 * (uZoomX, computed from the layer's band height, the texture's real aspect,
 * and the current canvas aspect — see resize()) so building proportions
 * stay correct at any aspect ratio; a narrower/taller viewport now shows a
 * tighter (but undistorted) horizontal slice instead of a squashed full one.
 */

interface LayerConfig {
  dayUrl: string;
  nightUrl: string;
  emissiveUrl: string;
  /** Screen-space Y range the quad spans, in [-1, 1] (bottom, top). */
  yBottom: number;
  yTop: number;
  /** How far the texture's U offset shifts per unit of normalized pointer motion. */
  parallaxStrength: number;
  /** Slow ambient drift, texture-U units per second, independent of input. */
  driftSpeed: number;
  renderOrder: number;
  /** Gentle window-glow pulse: radians/second and phase offset. Each layer
   * gets its own slightly different speed/phase (see LAYERS below) so the
   * three don't breathe in lockstep — a subtle desync reads as more alive
   * than one uniform pulse would. */
  pulseSpeed: number;
  pulsePhase: number;
}

// --- global skyline motion tuning -------------------------------------------
// Single dials layered over the per-layer parallax/drift below, so the whole
// skyline's liveliness can be tuned (or stilled) from one place without
// disturbing each layer's relative depth ratios.
//
// POINTER_PARALLAX_SCALE scales how much the buildings react to the cursor:
//   1    = original full-speed parallax
//   0.45 = earlier calmer pass
//   0    = current — buildings fully static to the pointer, so the day-mode
//          fog (which keeps its own inverted drift, see index.astro) is the
//          only thing moving: a still skyline with drifting haze over it
// AMBIENT_DRIFT_SCALE scales the constant, input-independent creep:
//   0    = current — no ambient building creep either, for a truly still city
//   1    = original slow drift
// Both apply in day and night alike — this is the shared parallax path. Bump
// either back above 0 to reintroduce a touch of building motion.
const POINTER_PARALLAX_SCALE = 0;
const AMBIENT_DRIFT_SCALE = 0;

const LAYERS: LayerConfig[] = [
  {
    dayUrl: '/textures/city/city_far_day.png',
    nightUrl: '/textures/city/city_far_night.png',
    emissiveUrl: '/textures/city/city_far_emissive.png',
    yBottom: -1,
    yTop: -0.55,
    parallaxStrength: 0.04,
    driftSpeed: 0.003,
    renderOrder: -900,
    pulseSpeed: 0.22,
    pulsePhase: 0.0,
  },
  {
    dayUrl: '/textures/city/city_mid_day.png',
    nightUrl: '/textures/city/city_mid_night.png',
    emissiveUrl: '/textures/city/city_mid_emissive.png',
    yBottom: -1,
    yTop: -0.25,
    parallaxStrength: 0.09,
    driftSpeed: 0.006,
    renderOrder: -800,
    pulseSpeed: 0.29,
    pulsePhase: 2.1,
  },
  {
    dayUrl: '/textures/city/city_near_day.png',
    nightUrl: '/textures/city/city_near_night.png',
    emissiveUrl: '/textures/city/city_near_emissive.png',
    yBottom: -1,
    yTop: 0.15,
    parallaxStrength: 0.17,
    driftSpeed: 0.01,
    renderOrder: -700,
    pulseSpeed: 0.35,
    pulsePhase: 4.4,
  },
];

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// All nine generated city PNGs (far/mid/near x day/night/emissive) share this
// native pixel aspect ratio (3600x900) — see outputs/gen_city_layers.py.
const TEXTURE_ASPECT = 4;

// Stage 6: cross-fades between the day and night textures per-pixel based
// on uDayFactor (0 = full night, 1 = full day — same value driving the sky
// gradient in ./sky.ts), rather than swapping meshes, so the transition is
// a smooth dissolve instead of a hard cut.
//
// Stage 7: additively stacks the emissive layer (lit windows + roofline
// glow only, see outputs/gen_city_layers.py) on top, boosted by
// uBloomStrength and scaled by (1 - uDayFactor) so it only lights up at
// night. Because this addition can push cyan/red channels past 1.0 while
// every other surface in the scene (white daytime buildings, sky, moon)
// stays clamped at/under 1.0, the bloom pass's threshold can isolate
// exactly this — real neon glow — without haloing plain white surfaces.
//
// Lighting mood pass (Fallen Angels reference, "mood D"): the emissive
// texture's window glow was recolored from cyan-dominant to a cold
// white/grey (see outputs/city_*_emissive.png), and a slow, gentle
// per-layer pulse was added (uTime * uPulseSpeed + uPulsePhase, each layer
// slightly desynced) so the glow breathes softly instead of sitting at a
// flat constant brightness. Paired with ./haze.ts, a separate ground-haze
// quad drawn over the whole scene that diffuses this glow near the bottom
// of the screen using the sky's own daytime blue.
const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D emissiveMap;
  uniform float uOffset;
  uniform float uDayFactor;
  uniform float uBloomStrength;
  uniform float uTime;
  uniform float uPulseSpeed;
  uniform float uPulsePhase;
  // Aspect-ratio correction (see resize() in createCityLayers): scales the
  // sampled horizontal window around its center so a narrower/taller canvas
  // shows a proportionally tighter slice instead of squeezing the same full
  // width into less physical space.
  uniform float uZoomX;
  varying vec2 vUv;
  void main() {
    vec2 uv = vec2((vUv.x - 0.5) / uZoomX + 0.5 + uOffset, vUv.y);
    vec4 dayColor = texture2D(dayMap, uv);
    vec4 nightColor = texture2D(nightMap, uv);
    vec4 base = mix(nightColor, dayColor, uDayFactor);
    float pulse = 0.88 + 0.12 * sin(uTime * uPulseSpeed + uPulsePhase);
    vec3 emissive = texture2D(emissiveMap, uv).rgb * uBloomStrength * (1.0 - uDayFactor) * pulse;
    gl_FragColor = vec4(base.rgb + emissive, base.a);
  }
`;

interface Layer {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dayTexture: THREE.Texture;
  nightTexture: THREE.Texture;
  emissiveTexture: THREE.Texture;
  config: LayerConfig;
}

export interface CityLayers {
  group: THREE.Group;
  update: (dtSeconds: number, dayFactor: number) => void;
  resize: (aspect: number) => void;
  dispose: () => void;
}

export function createCityLayers(): CityLayers {
  const group = new THREE.Group();
  const loader = new THREE.TextureLoader();

  function loadLayerTexture(url: string): THREE.Texture {
    const texture = loader.load(url);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  const layers: Layer[] = LAYERS.map((config) => {
    const dayTexture = loadLayerTexture(config.dayUrl);
    const nightTexture = loadLayerTexture(config.nightUrl);
    const emissiveTexture = loadLayerTexture(config.emissiveUrl);

    // A quad spanning the full screen width but only the layer's vertical
    // band; built directly in NDC-ish [-1,1] space like the sky dome.
    const geometry = new THREE.PlaneGeometry(2, config.yTop - config.yBottom);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: dayTexture },
        nightMap: { value: nightTexture },
        emissiveMap: { value: emissiveTexture },
        uOffset: { value: 0 },
        uDayFactor: { value: 0 },
        uBloomStrength: { value: 2.8 },
        uZoomX: { value: 1 },
        uTime: { value: 0 },
        uPulseSpeed: { value: config.pulseSpeed },
        uPulsePhase: { value: config.pulsePhase },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = config.renderOrder;
    // The vertex shader reads `position.xy` directly as clip space (no
    // model/view/projection applied — same trick as the sky quad), so
    // `mesh.position` would be ignored. Bake the vertical offset into the
    // geometry itself instead so the quad's span lands at [yBottom, yTop].
    const centerY = (config.yTop + config.yBottom) / 2;
    geometry.translate(0, centerY, 0);

    group.add(mesh);
    return { mesh, material, dayTexture, nightTexture, emissiveTexture, config };
  });

  let elapsed = 0;
  let smoothedPointer = 0;

  function update(dtSeconds: number, dayFactor: number, pointerX = 0) {
    elapsed += dtSeconds;
    // Ease toward the latest pointer reading rather than snapping, so touch
    // drags and mouse moves feel like drift, not jitter.
    smoothedPointer += (pointerX - smoothedPointer) * Math.min(1, dtSeconds * 4);

    for (const layer of layers) {
      const drift = elapsed * layer.config.driftSpeed * AMBIENT_DRIFT_SCALE;
      const parallax = smoothedPointer * layer.config.parallaxStrength * POINTER_PARALLAX_SCALE;
      layer.material.uniforms.uOffset.value = drift + parallax;
      layer.material.uniforms.uDayFactor.value = dayFactor;
      layer.material.uniforms.uTime.value = elapsed;
    }
  }

  // Recomputes each layer's horizontal zoom so the 4:1 source art keeps its
  // real proportions at the current canvas aspect ratio, instead of being
  // uniformly stretched full-width regardless of shape. Derivation: the
  // band's height in physical pixels is (bandHeight/2) * canvas height, and
  // the visible U window's physical width is (1/zoom) * canvas width; for
  // texture pixels to stay square, those two must scale by the texture's
  // own aspect ratio, which solves to the line below. Call on init and on
  // every resize (see scene.ts).
  function resize(aspect: number) {
    for (const layer of layers) {
      const bandHeight = layer.config.yTop - layer.config.yBottom;
      layer.material.uniforms.uZoomX.value = (bandHeight / 2) * TEXTURE_ASPECT / aspect;
    }
  }

  function dispose() {
    for (const layer of layers) {
      layer.mesh.geometry.dispose();
      layer.material.dispose();
      layer.dayTexture.dispose();
      layer.nightTexture.dispose();
      layer.emissiveTexture.dispose();
    }
  }

  return {
    group,
    update: (dtSeconds: number, dayFactor: number) => update(dtSeconds, dayFactor, latestPointerX),
    resize,
    dispose,
  };
}

// --- pointer/touch tracking -------------------------------------------------
// Module-level because `update` above is called every frame from the main
// render loop and needs the latest value without plumbing an event bus
// through every call site.
let latestPointerX = 0;

/**
 * Normalizes mouse and touch position to roughly [-1, 1] across the
 * viewport width. Touch support is required, not optional — this site
 * must parallax on mobile via drag, not just desktop mouse-move.
 */
export function attachPointerTracking(target: Window = window): () => void {
  function setFromClientX(clientX: number) {
    latestPointerX = (clientX / window.innerWidth) * 2 - 1;
  }

  function onMouseMove(e: MouseEvent) {
    setFromClientX(e.clientX);
  }
  function onTouchMove(e: TouchEvent) {
    if (e.touches.length > 0) {
      setFromClientX(e.touches[0].clientX);
    }
  }

  target.addEventListener('mousemove', onMouseMove, { passive: true });
  target.addEventListener('touchmove', onTouchMove, { passive: true });

  return function detach() {
    target.removeEventListener('mousemove', onMouseMove);
    target.removeEventListener('touchmove', onTouchMove);
  };
}
