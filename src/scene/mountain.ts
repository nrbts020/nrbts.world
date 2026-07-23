import * as THREE from 'three';

/**
 * Distant mountain silhouette (Mt. Fuji / Mt. Hood inspired) — a personal
 * nod to Norbert's outdoor life and living near Mt. Hood, sitting far behind
 * the skyline as the single farthest scene layer.
 *
 * Same camera-independent screen-space quad trick as sky.ts / city.ts /
 * haze.ts: the vertex shader ignores the view/projection matrices, so this
 * always fills the viewport and the mountain is drawn purely as a function
 * of screen-space vUv in the fragment shader. renderOrder -950 puts it just
 * above the sky (-1000) and below every building layer (far -900 → near
 * -700), so the skyline overlaps and grounds it rather than it floating in
 * front. It's a flat, geometric silhouette — no texture, no naturalistic
 * detail — to stay in the same reduced 2.5D language as the buildings, and
 * it cross-fades day↔night on the same uDayFactor as everything else so it
 * belongs to the palette instead of sitting on top of it.
 *
 * Deliberately kept low-contrast / aerial-perspective pale in day and a
 * quiet dark mass at night, so it reads as far-off atmosphere, not a
 * foreground feature. All shape parameters are the clearly-named `const`s at
 * the top of the fragment shader — tune those to taste.
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uDayFactor;   // 0 = night, 1 = day (shared clock value)
  uniform float uAspect;      // canvas width / height, so slope is shape-correct
  uniform float uOpacity;     // overall presence; lower = more it dissolves into haze
  varying vec2 vUv;

  // --- shape (all in screen-space vUv, 0..1; y is 0=bottom, 1=top) ---------
  const float PEAK_X   = 0.58;  // horizontal position of the summit
  const float PEAK_Y   = 0.48;  // screen height the summit reaches (stays below the tall towers)
  const float BASE_Y   = 0.28;  // screen height of the base/horizon (behind buildings)
  const float HALF_W   = 0.58;  // half-width of the base, in aspect-corrected units
  const float FLARE    = 0.82;  // <1 = concave Fuji flare (steep summit, flared skirt)
  const float SNOW_FRAC= 0.66;  // fraction up the mountain where snow begins

  void main() {
    float height = PEAK_Y - BASE_Y;

    // horizontal distance from the summit axis, aspect-corrected so the
    // slope looks the same on any viewport shape
    float px = (vUv.x - PEAK_X) * uAspect;
    float xn = clamp(abs(px) / HALF_W, 0.0, 1.0);

    // mountain top surface height at this x (concave-flanked cone)
    float surf = BASE_Y + height * (1.0 - pow(xn, FLARE));

    // inside the silhouette where the fragment is below the surface, with a
    // little smoothstep AA along the ridge
    float aa = 0.006;
    float inside = smoothstep(surf + aa, surf - aa, vUv.y);
    if (inside <= 0.0) discard; // open sky — let the sky layer show through

    // snow cap: a wavy near-horizontal snowline; because the cone narrows
    // upward, a flat snowline naturally yields a small pointed cap
    float snowLine = BASE_Y + height * SNOW_FRAC
      + 0.030 * sin(px * 12.0) + 0.018 * sin(px * 27.0);
    float snow = smoothstep(snowLine - 0.025, snowLine + 0.025, vUv.y);

    // palette — pale steel body + soft snow in day; dark mass + dim moonlit
    // snow at night. Low contrast on purpose (aerial perspective).
    vec3 dayBody   = vec3(0.612, 0.737, 0.835); // #9cbcd4
    vec3 nightBody = vec3(0.071, 0.137, 0.227); // #12233a
    vec3 daySnow   = vec3(0.902, 0.933, 0.957); // #e6eef4
    vec3 nightSnow = vec3(0.290, 0.392, 0.502); // #4a6480

    vec3 body = mix(nightBody, dayBody, uDayFactor);
    vec3 snowC = mix(nightSnow, daySnow, uDayFactor);
    vec3 col = mix(body, snowC, snow);

    // faint vertical form: a touch lighter toward the top
    col *= (0.94 + 0.06 * ((vUv.y - BASE_Y) / height));

    // dissolve the very base into the haze band so it doesn't cut a hard
    // line where it meets the bottom of the skyline
    float baseFade = smoothstep(BASE_Y - 0.02, BASE_Y + 0.10, vUv.y);

    gl_FragColor = vec4(col, uOpacity * inside * baseFade);
  }
`;

export interface Mountain {
  mesh: THREE.Mesh;
  update: (dayFactor: number) => void;
  resize: (aspect: number) => void;
  dispose: () => void;
}

export function createMountain(): Mountain {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uDayFactor: { value: 1 },
      uAspect: { value: 1 },
      uOpacity: { value: 0.55 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Just above the sky (-1000), below every building layer (far -900), so
  // the skyline overlaps and grounds the mountain.
  mesh.renderOrder = -950;

  function update(dayFactor: number) {
    material.uniforms.uDayFactor.value = dayFactor;
  }

  function resize(aspect: number) {
    material.uniforms.uAspect.value = aspect;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return { mesh, update, resize, dispose };
}
