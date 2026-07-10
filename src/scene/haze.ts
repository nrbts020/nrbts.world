import * as THREE from 'three';

/**
 * Ground haze (lighting mood pass, referencing Wong Kar-wai's Fallen
 * Angels): a soft, cold, light-blue atmospheric fog that rises from the
 * bottom of the screen at night, diffusing the city's window glow the way
 * real haze softens distant light sources. The color is pulled straight
 * from the sky's own daytime palette (see sky.ts DAY_BOTTOM = 0xbfe0f2)
 * rather than an unrelated "night mood" color, so the city reads as the
 * same world under different light, day or night.
 *
 * Same camera-independent screen-space quad trick as sky.ts/city.ts, drawn
 * after every city layer (renderOrder above the near layer's -700) so its
 * gradient sits over the full skyline, not just one band. Alpha rises
 * smoothly from a fixed height near the bottom of the screen; no aspect
 * correction needed since the gradient is purely a function of vUv.y, which
 * is already screen-space regardless of canvas shape.
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 hazeColor;
  uniform float uNightFactor;
  uniform float uStrength;
  uniform float uRise;
  varying vec2 vUv;
  void main() {
    // vUv.y runs 0 (bottom of screen) to 1 (top). Haze fades out above
    // uRise, so it stays a ground-hugging effect rather than tinting the sky.
    float t = clamp((uRise - vUv.y) / uRise, 0.0, 1.0);
    t = pow(t, 1.4);
    float alpha = uStrength * t * uNightFactor;
    gl_FragColor = vec4(hazeColor, alpha);
  }
`;

export interface GroundHaze {
  mesh: THREE.Mesh;
  update: (nightFactor: number) => void;
  dispose: () => void;
}

export function createGroundHaze(): GroundHaze {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      // == sky.ts DAY_BOTTOM (0xbfe0f2) -- see module comment above.
      hazeColor: { value: new THREE.Color(0xbfe0f2) },
      uNightFactor: { value: 1 },
      // Mood D from the visual comparison: the subtler of the two haze
      // strengths tried, mostly hugging the ground rather than washing the
      // whole lower skyline.
      uStrength: { value: 0.22 },
      uRise: { value: 0.42 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Above the near city layer (-700) so the haze sits over the whole
  // skyline, not just whichever layer happens to render last in a given
  // region.
  mesh.renderOrder = -600;

  function update(nightFactor: number) {
    material.uniforms.uNightFactor.value = nightFactor;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}
