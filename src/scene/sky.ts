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

// Moon-removal follow-up: the moon used to be the sky's one point of visual
// interest at night. In its place, a Milky Way haze band + starfield fades
// in as uNightFactor rises (1 - dayFactor, so it uses the exact same
// smoothstepped dawn/dusk curve as everything else — no separate easing, no
// hard cut) and animates via uTime, which is fed a running elapsed-seconds
// value every frame (see scene.ts) independent of the once-a-second
// clock/color update. (An Aurora Borealis variant was prototyped alongside
// this for comparison and dropped per feedback — Milky Way read better.)
//
// Refined twice per feedback. First pass: stars were too coarse/blocky (a
// single hashed grid cell either fully "on" or "off" reads as flat grain,
// not points) — fixed with a jittered sub-cell position and tight radial
// falloff, layered at three grid scales for depth. Second pass (this one):
// the band was near-vertical, which read as a "bat signal" beam shooting
// straight up out of the city rather than an overhead galactic band, and
// its dust-lane texture was built from a few sine waves whose regular
// interference pattern looked too uniform. Fixed by (1) tilting the band to
// a proper corner-to-corner diagonal (per reference photo) with a soft fade
// at both tips instead of running edge-to-edge, narrowing it, and removing
// the width-wobble that gave it a flared/conical silhouette, and (2)
// replacing the sine-sum texture with a small hash-based value-noise fbm
// (2-3 octaves — still cheap, not true Perlin) so the dust lanes read as
// organic clumps/rifts running along the band instead of a regular ripple.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float exponent;
  uniform float uTime;
  uniform float uNightFactor;
  // Aspect-ratio correction (mobile fix): uv is 0..1 across the FULL canvas
  // regardless of its shape, so 1 unit horizontally and 1 unit vertically
  // are different physical pixel counts on a non-square viewport. Without
  // correcting for this, stars sampled straight from uv render as ovals
  // (stretched along whichever axis has more pixels per uv-unit) and the
  // band's tilt/width read at the wrong on-screen angle on a narrow/tall
  // phone. aspectCorrect() rescales x by the canvas aspect so 1 corrected
  // unit is the same physical distance on both axes.
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

  // Cheap hash-based value noise (bilinear-interpolated grid hash) — a small
  // fbm of this reads as organic mottled clumping, unlike raw sine sums
  // which tend to show a regular interference ripple at this scale.
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.55;
    for (int i = 0; i < 3; i++) {
      v += amp * valueNoise(p);
      p *= 2.03;
      amp *= 0.5;
    }
    return v;
  }

  // A hashed grid with a jittered sub-cell star position and a tight radial
  // falloff, so each star reads as a crisp point instead of a filled grid
  // square. "density" is a hash threshold (closer to 1 = sparser), "size"
  // is the point radius in cell-local units (small relative to 1.0 keeps it
  // sharp), "scale" is the grid resolution (higher = finer grain).
  float starLayer(vec2 uv, float scale, float density, float size, float t) {
    vec2 gv = aspectCorrect(uv) * scale;
    vec2 cell = floor(gv);
    vec2 cellUv = fract(gv);
    float h = hash(cell);
    if (h < density) return 0.0;
    vec2 jitter = hash2(cell + 11.0);
    float d = length(cellUv - jitter);
    float core = smoothstep(size, 0.0, d);
    float brightness = hash(cell + 5.0);
    float twinkle = 0.75 + 0.25 * sin(t * (1.5 + brightness * 2.0) + brightness * 30.0);
    return core * (0.35 + 0.65 * brightness) * twinkle;
  }

  vec3 milkyWayColor(vec2 uv, float t) {
    // Corner-to-corner diagonal sweep (per reference), not a near-vertical
    // beam — a real overhead galactic band cuts across at a steep angle
    // from vertical, not straight up.
    float tilt = radians(52.0);
    vec2 dir = vec2(sin(tilt), cos(tilt));
    vec2 perp = vec2(cos(tilt), -sin(tilt));
    // Same pivot as before (0.58, 0.66) re-expressed in aspect-corrected
    // space, so the band sits in the same place but its angle/width now
    // read correctly regardless of viewport shape.
    vec2 p = aspectCorrect(uv) - vec2(0.08 * uAspect, 0.16);
    float along = dot(p, dir);
    float across = dot(p, perp);

    // Noise coordinates stretched along the band's length so clumps/rifts
    // read as streaks running with the band, not perpendicular blobs.
    float n = fbm(vec2(along * 5.0, across * 11.0));

    // Narrower than the first pass, with only a slight width wobble — not
    // enough to pinch into a cone/beam silhouette.
    float widthMod = 0.085 + 0.015 * sin(along * 4.0 + 1.7);
    float band = smoothstep(widthMod, 0.0, abs(across));

    // Fades toward both tips instead of running edge-to-edge at full
    // strength, so it reads as a finite band, brightest near its middle.
    float lengthFade = smoothstep(1.05, 0.15, abs(along));

    float cloud = mix(0.22, 1.0, n);
    // Denser, brighter clumps skew toward a warm magenta core glow (H II
    // regions in the reference); fainter wisps stay cool blue-white.
    vec3 edgeColor = vec3(0.74, 0.79, 0.90);
    vec3 coreColor = vec3(0.88, 0.76, 0.85);
    vec3 hazeColor = mix(edgeColor, coreColor, cloud);

    vec3 haze = hazeColor * band * cloud * lengthFade * 0.75;

    // Three layers of decreasing density/size — faint dense background,
    // a mid layer, and a sparse layer of larger brighter points — for the
    // depth a real starfield has, rather than one uniform speckle.
    float stars = 0.0;
    stars += starLayer(uv, 950.0, 0.9975, 0.28, t) * 0.55;
    stars += starLayer(uv, 560.0, 0.9955, 0.22, t + 4.0) * 0.85;
    stars += starLayer(uv, 260.0, 0.9975, 0.16, t + 10.0) * 1.15;
    vec3 starColor = vec3(1.0, 0.99, 0.96) * stars;

    return haze + starColor;
  }

  void main() {
    float t = pow(clamp(vUv.y, 0.0, 1.0), exponent);
    vec3 base = mix(bottomColor, topColor, t);
    base += milkyWayColor(vUv, uTime) * uNightFactor;
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
