/**
 * The light a shaded lamp throws on the wall beside it: an open drum lets
 * the bulb shine straight up and down, so the wall behind it carries two
 * bright arcs (the shade's rims projected as hyperbolas) fading with
 * distance, with the wall between them in the shade's soft shadow. One
 * additive quad on the wall per lamp; its strength follows the lamp.
 */
import * as THREE from 'three';
/** Returns the mesh (house-local) and the uniform that scales it (set to the lamp's level × strength). */
export function lampScallop(s) {
    const n = s.wallNormal.clone().normalize();
    // the quad centred on the bulb's foot on the wall, a hair off its face
    const foot = s.bulb.clone().sub(n.clone().multiplyScalar(s.bulb.clone().sub(s.wallPoint).dot(n)));
    if (s.along !== undefined) {
        if (Math.abs(n.x) > Math.abs(n.z))
            foot.z = s.along;
        else
            foot.x = s.along;
    }
    const g = new THREE.PlaneGeometry(s.width, s.height);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    g.applyQuaternion(q);
    g.translate(foot.x + n.x * 0.004, s.y0 + s.height / 2, foot.z + n.z * 0.004);
    const level = { value: 1 };
    const mat = new THREE.ShaderMaterial({
        name: 'lampScallop',
        uniforms: {
            uBulb: { value: s.bulb.clone() },
            uShade: { value: new THREE.Vector4(s.top[0], s.top[1], s.bottom[0], s.bottom[1]) },
            uLevel: level,
            uColor: { value: new THREE.Color(s.color ?? 0xffb46a) },
        },
        vertexShader: /* glsl */ `
      varying vec3 vP;
      varying vec2 vUv;
      void main() { vP = position; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
      uniform vec3 uBulb; uniform vec4 uShade; uniform float uLevel; uniform vec3 uColor;
      varying vec3 vP;
      varying vec2 vUv;
      void main() {
        vec3 d = vP - uBulb;
        // fade out before the quad's edges (window trims, corners)
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.12, e.x) * smoothstep(0.0, 0.08, e.y);
        float h = length(d.xz);
        float k = 0.0;
        if (d.y > 0.0) {
          // through the top opening: the rim's shadow edge, softened by the bulb's size
          float r = h * uShade.x / d.y;
          k = 1.0 - smoothstep(uShade.y * 0.8, uShade.y * 1.25, r);
        } else {
          float r = h * uShade.z / max(-d.y, 1e-4);
          k = 1.0 - smoothstep(uShade.w * 0.8, uShade.w * 1.25, r);
        }
        float fall = 1.0 / (dot(d, d) + 0.04);
        // the linen glows a little all round: a faint halo hugging the shade
        float halo = exp(-dot(d, d) * 9.0) * 0.35;
        float a = (k * fall * 0.055 + halo * 0.06) * uLevel * edge;
        if (a < 0.0005) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'lamp-scallop';
    mesh.renderOrder = 2;
    mesh.raycast = () => { };
    return { mesh, level };
}
