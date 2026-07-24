import * as THREE from 'three';

/**
 * Stage 3: day/night sky gradient driven by local clock time.
 * No SunCalc yet — just a time-of-day -> color-stop function. Stage 4
 * replaces `dayFactor` with a real sun-altitude curve from SunCalc, but
 * the color stops and the dome/shader stay the same.
 *
 * Mirror's Edge palette:
 *  - Day:   steel-blue zenith -> pale near-white horizon haze.
 *  - Night: near-black zenith -> cool moonlit haze near the rooftops.
 * No warm dawn/dusk oranges — the brief is explicit that reds are an
 * accent used sparingly elsewhere (UI, lit windows), never in the sky.
 */

const NIGHT_TOP = new THREE.Color(0x05070a);
const NIGHT_BOTTOM = new THREE.Color(0x35577a);

// Punchier, more saturated cerulean blue — the reference game screenshots
// keep the sky vividly blue almost all the way down, not pale/grey.
const DAY_TOP = new THREE.Color(0x1c6fc9);
const DAY_BOTTOM = new THREE.Color(0xbfe0f2);

const DAWN_START = 5;
const DAWN_END = 7;
const DUSK_START = 18;
const DUSK_END = 20;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 0 = full night, 1 = full day. Purely clock-driven placeholder for
 * Stage 4's real sun-altitude-based factor.
 */
export function dayFactor(hours: number): number {
  if (hours >= DAWN_END && hours <= DUSK_START) return 1;
  if (hours <= DAWN_START || hours >= DUSK_END) return 0;
  if (hours < DAWN_END) return smoothstep(DAWN_START, DAWN_END, hours);
  return 1 - smoothstep(DUSK_START, DUSK_END, hours);
}

export function hoursOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

export function computeSkyColors(date: Date): { top: THREE.Color; bottom: THREE.Color } {
  const f = dayFactor(hoursOf(date));
  const top = new THREE.Color().lerpColors(NIGHT_TOP, DAY_TOP, f);
  const bottom = new THREE.Color().lerpColors(NIGHT_BOTTOM, DAY_BOTTOM, f);
  return { top, bottom };
}

// A camera-independent fullscreen quad: the vertex shader ignores the
// view/projection matrices entirely, so this always fills the viewport
// exactly, with the zenith pinned to the very top of the screen and the
// horizon pinned to the very bottom — matching "steel-blue zenith fading
// to horizon haze" literally, regardless of camera FOV or position. This
// also gives the future city layers (Stage 5+) a predictable screen-space
// band to sit in near the bottom.
const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Moon-removal follow-up: the night sky's one point of interest is now a
// soft, diffuse starfield that fades in as uNightFactor rises (1 -
// dayFactor -- the same smoothstepped dawn/dusk curve as everything else)
// and twinkles via uTime. An earlier magenta/blue "Milky Way" band (and an
// aurora variant before that) was dropped: the drifting day/night clouds
// (see index.astro) now carry the sky's atmospheric light, so the sky
// itself stays quiet. Two deliberate choices keep the stars inside the
// design system rather than looking pasted on: they're feathered soft
// glows, not crisp pinpoints, to match the clouds' soft light; and they
// wash out toward the horizon where the city's ground haze sits (see
// haze.ts), dissolving into the same atmosphere instead of floating as
// hard pixels over the rooftops.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float exponent;
  uniform float uTime;
  uniform float uNightFactor;
  // Aspect-ratio correction (mobile fix): uv is 0..1 across the FULL canvas
  // whatever its shape, so 1 unit of x and 1 unit of y are different pixel
  // counts on a non-square viewport. Without correcting, stars sampled
  // straight from uv render as ovals; aspectCorrect() rescales x by the
  // canvas aspect so 1 corrected unit is the same physical distance on both.
  uniform float uAspect;
  varying vec2 vUv;

  vec2 aspectCorrect(vec2 uv) {
    vec2 p = uv - 0.5;
    p.x *= uAspect;
    return p;
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  vec2 hash2(vec2 p) {
    return vec2(hash(p), hash(p + 19.19));
  }

  // A soft, diffuse star: a feathered glow rather than a crisp pinpoint, so
  // the starfield sits in the same soft-light family as the drifting clouds
  // instead of reading as hard grid pixels. "size" is the glow radius in
  // cell-local units; squaring the smoothstep feathers the falloff so there
  // is no hard core.
  float starLayer(vec2 uv, float scale, float density, float size, float t) {
    vec2 gv = aspectCorrect(uv) * scale;
    vec2 base = floor(gv);
    vec2 f = fract(gv);
    float acc = 0.0;
    // Sample the 3x3 neighbourhood so each star's soft glow spills smoothly
    // across cell borders instead of being clipped into a hard arc at the
    // edge -- that's what lets the blobs be big and diffuse without artefacts.
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = base + vec2(float(i), float(j));
        if (hash(cell) < density) continue;
        vec2 jitter = hash2(cell + 11.0);
        float d = length(vec2(float(i), float(j)) + jitter - f);
        float glow = smoothstep(size, 0.0, d);
        glow = pow(glow, 0.7); // spread brightness outward -> soft, hazy blob
        float brightness = hash(cell + 5.0);
        float twinkle = 0.85 + 0.15 * sin(t * (1.0 + brightness * 1.4) + brightness * 30.0);
        acc += glow * (0.22 + 0.5 * brightness) * twinkle;
      }
    }
    return acc;
  }

  // Two sparse layers of big, soft, low-contrast glows for a little depth --
  // deliberately few and diffuse (soft even at the top of the sky), a cool
  // moonlit white to match the clouds.
  vec3 starField(vec2 uv, float t) {
    float stars = 0.0;
    stars += starLayer(uv, 150.0, 0.9988, 0.52, t) * 0.50;
    stars += starLayer(uv, 260.0, 0.9990, 0.42, t + 5.0) * 0.36;
    return vec3(0.85, 0.89, 0.98) * stars;
  }

  void main() {
    float t = pow(clamp(vUv.y, 0.0, 1.0), exponent);
    vec3 base = mix(bottomColor, topColor, t);

    // Stars wash out toward the horizon where the city's ground haze sits
    // (see haze.ts, uRise ~0.42): brightest high in the sky, dissolving into
    // the haze near the rooftops so they read as part of the same atmosphere
    // as the clouds, not hard points floating over the skyline.
    float hazeVeil = smoothstep(0.28, 0.50, vUv.y);
    base += starField(vUv, uTime) * uNightFactor * hazeVeil;

    gl_FragColor = vec4(base, 1.0);
  }
`;

export interface SkyDome {
  mesh: THREE.Mesh;
  update: (date: Date) => void;
  updateTime: (elapsedSeconds: number) => void;
  resize: (aspect: number) => void;
  dispose: () => void;
}

export function createSkyDome(): SkyDome {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: NIGHT_TOP.clone() },
      bottomColor: { value: NIGHT_BOTTOM.clone() },
      exponent: { value: 0.55 },
      uTime: { value: 0 },
      uNightFactor: { value: 1 },
      uAspect: { value: 1 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  function update(date: Date) {
    const { top, bottom } = computeSkyColors(date);
    (material.uniforms.topColor.value as THREE.Color).copy(top);
    (material.uniforms.bottomColor.value as THREE.Color).copy(bottom);
    material.uniforms.uNightFactor.value = 1 - dayFactor(hoursOf(date));
  }

  function updateTime(elapsedSeconds: number) {
    material.uniforms.uTime.value = elapsedSeconds;
  }

  function resize(aspect: number) {
    material.uniforms.uAspect.value = aspect;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return { mesh, update, updateTime, resize, dispose };
}
