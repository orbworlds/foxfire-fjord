/**
 * The sky mirrored in the calm fjord: the dome (atmosphere, aurora, moon,
 * stars and clouds) rendered from a camera mirrored below the sea surface into
 * a small render target once per frame (after the camera and the sky moved). The sea
 * shader looks its reflected rays up in it (the sky is at infinity, so a
 * direction projects straight through the mirror camera), which keeps the
 * aurora's curtains and rays crisp in the water where the cube map would
 * smear them. Rays that leave the mirror camera's view fall back to the cube.
 */
import * as THREE from 'three';
/** render-target size relative to the drawing buffer, per quality */
const SCALE = { low: 0.3, medium: 0.4, high: 0.5, ultra: 0.6 };
/** the mirror camera sees a little more than the real one (rippled rays tilt out of its frame) */
const FOV_MARGIN = 1.12;
export class SkyMirror {
    target;
    /** view-projection of the mirror camera (directions → clip space) */
    viewProj = new THREE.Matrix4();
    scene = new THREE.Scene();
    dome;
    cam = new THREE.PerspectiveCamera(50, 1, 1, 30000);
    size = new THREE.Vector2();
    fwd = new THREE.Vector3();
    up = new THREE.Vector3();
    pos = new THREE.Vector3();
    quat = new THREE.Quaternion();
    lastFrame = -1;
    scale;
    enabled = true;
    constructor(sky, quality) {
        this.scale = SCALE[quality] ?? 0.4;
        this.target = new THREE.WebGLRenderTarget(4, 4, {
            type: THREE.HalfFloatType,
            depthBuffer: false,
            stencilBuffer: false,
            generateMipmaps: false,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
        });
        this.target.texture.name = 'fox-sky-mirror';
        // same geometry and material as the real dome (uniforms shared, so it shows the same sky)
        this.dome = new THREE.Mesh(sky.geometry, sky.material);
        this.dome.scale.copy(sky.scale);
        this.dome.frustumCulled = false;
        this.scene.add(this.dome);
    }
    setQuality(quality) {
        this.scale = SCALE[quality] ?? 0.4;
    }
    /** Render the mirrored sky for this frame's camera (once per frame). */
    render(renderer, camera, frame) {
        if (!this.enabled || frame === this.lastFrame)
            return;
        this.lastFrame = frame;
        renderer.getDrawingBufferSize(this.size);
        const w = Math.max(32, Math.round(this.size.x * this.scale));
        const h = Math.max(32, Math.round(this.size.y * this.scale));
        if (this.target.width !== w || this.target.height !== h)
            this.target.setSize(w, h);
        // the camera hangs straight off the scene: its local transform is its world transform
        this.pos.copy(camera.position);
        this.quat.copy(camera.quaternion);
        this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
        this.up.set(0, 1, 0).applyQuaternion(this.quat);
        const c = this.cam;
        c.position.set(this.pos.x, -this.pos.y, this.pos.z);
        c.up.set(this.up.x, -this.up.y, this.up.z);
        this.fwd.y = -this.fwd.y;
        this.fwd.add(c.position);
        c.lookAt(this.fwd);
        c.fov = Math.min(150, camera.fov * FOV_MARGIN);
        c.aspect = camera.aspect;
        c.near = 1;
        c.far = 30000;
        c.updateProjectionMatrix();
        c.updateMatrixWorld(true);
        this.viewProj.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
        this.dome.position.copy(c.position);
        this.dome.updateMatrixWorld(true);
        const prevTarget = renderer.getRenderTarget();
        const prevXr = renderer.xr.enabled;
        const prevShadow = renderer.shadowMap.autoUpdate;
        const prevAuto = renderer.autoClear;
        renderer.xr.enabled = false;
        renderer.shadowMap.autoUpdate = false;
        renderer.autoClear = true;
        // no stars: at this size a bright one would smear into a blob (calm water shows them only faintly)
        const u = this.dome.material.uniforms;
        const stars = u.uStarIntensity ? u.uStarIntensity.value : 0;
        if (u.uStarIntensity)
            u.uStarIntensity.value = 0;
        renderer.setRenderTarget(this.target);
        renderer.render(this.scene, c);
        if (u.uStarIntensity)
            u.uStarIntensity.value = stars;
        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevAuto;
        renderer.shadowMap.autoUpdate = prevShadow;
        renderer.xr.enabled = prevXr;
    }
    dispose() {
        this.target.dispose();
    }
}
