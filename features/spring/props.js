/**
 * Furniture of the hot spring: the red changing hut with a bench and a
 * sheepskin under its window, two wax torches beside the boardwalk, and the
 * painted sign at the end of the path from the cabin. Geometry in world
 * space, grouped for merging per material.
 */
import * as THREE from 'three';
import { applyBoxUV, hitBox, snowCap } from '../../core/geometry.js';
import { heightAt } from '../../world/terrain-height.js';
import { buildHut, hutGlowMaterial } from '../lake/hut.js';
import { makeCanvas, SERIF } from '../paths/kit/text.js';
import { HUT, SIGN, TORCHES } from './layout.js';
export const SIGN_TEXT = 'HOT SPRING Varmkilden 39 °C Soak, look north, breathe out. Fox Peak 1h20 ↑';
function signTexture() {
    const W = 512;
    const H = 256;
    const [c, g] = makeCanvas(W, H);
    // weathered red-brown paint with a white border line
    g.fillStyle = '#5c241b';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,235,220' : '20,8,5'},${0.02 + Math.random() * 0.05})`;
        g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 30, 1 + Math.random() * 2);
    }
    g.strokeStyle = 'rgba(240,232,220,0.85)';
    g.lineWidth = 5;
    g.strokeRect(14, 14, W - 28, H - 28);
    g.fillStyle = '#efe7da';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `700 70px ${SERIF}`;
    g.fillText('HOT SPRING', W / 2, 104);
    g.font = `italic 400 34px ${SERIF}`;
    g.fillText('Varmkilden  ·  39 °C', W / 2, 152);
    g.font = `400 25px ${SERIF}`;
    g.fillText('Soak, look north, breathe out.', W / 2, 206);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}
export function buildProps(ctx) {
    const M = ctx.materials;
    const group = new THREE.Group();
    group.name = 'spring-props';
    const add = (g, m, cast = true) => {
        const mesh = new THREE.Mesh(g, m);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
    };
    const circles = [];
    const flames = [];
    /* ---------- changing hut ---------- */
    const glow = hutGlowMaterial('springHutWindow');
    const floorY = Math.max(heightAt(HUT.x, HUT.z), heightAt(HUT.x - 1, HUT.z - 1.2), heightAt(HUT.x + 1, HUT.z + 1.2)) + 0.18;
    const hut = buildHut(ctx, {
        name: 'spring-hut',
        x: HUT.x,
        z: HUT.z,
        y: floorY,
        rotY: HUT.rotY,
        w: HUT.w,
        d: HUT.d,
        wallH: HUT.wallH,
        pitch: HUT.pitch,
        eave: 0.32,
        rake: 0.22,
        wall: 'faluRed',
        trim: 'whiteTrim',
        doors: [{ side: 'front', s: 0.5, y: 0, w: 0.72, h: 1.78 }],
        windows: [
            { side: 'front', s: -0.62, y: 0.95, w: 0.5, h: 0.5 },
            { side: 'right', s: 0, y: 1.0, w: 0.46, h: 0.56 },
        ],
        pipe: { x: -0.7, z: -0.45, r: 0.055, h: 0.55 },
        base: 'stones',
        baseH: 0.16,
        snow: 0.3,
        icicles: 0.32,
        seed: 11,
    }, glow);
    for (const [x, z] of hut.corners)
        circles.push({ x, z, r: 0.15 });
    /* ---------- a towel and a robe on pegs by the door ---------- */
    {
        const hd = HUT.d / 2;
        const towelMat = new THREE.MeshStandardMaterial({ name: 'springTowel', color: 0xa83b30, roughness: 0.95 });
        const robeMat = M.get('linen');
        for (const [lx, w, h, mat] of [
            [1.06, 0.26, 0.6, towelMat],
            [-0.12, 0.33, 0.92, robeMat],
        ]) {
            const g = new THREE.BoxGeometry(w, h, 0.03, 4, 6, 1);
            const pos = g.getAttribute('position');
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i);
                const y = pos.getY(i);
                // hung from a peg: gathered at the top, folds lower down, the hem swinging out a little
                const k = (h / 2 - y) / h;
                pos.setX(i, x * (0.55 + 0.45 * k));
                pos.setZ(i, pos.getZ(i) + 0.02 * Math.sin(x * 40) * k + 0.04 * k * k);
            }
            g.computeVertexNormals();
            applyBoxUV(g);
            g.translate(lx, 1.62 - h / 2, hd + 0.05);
            g.applyMatrix4(new THREE.Matrix4().makeRotationY(HUT.rotY).setPosition(HUT.x, floorY, HUT.z));
            const mesh = new THREE.Mesh(g, mat);
            mesh.castShadow = true;
            mesh.userData.snow = 0;
            group.add(mesh);
            const peg = new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6);
            peg.rotateX(Math.PI / 2);
            peg.translate(lx, 1.64, hd + 0.05);
            peg.applyMatrix4(new THREE.Matrix4().makeRotationY(HUT.rotY).setPosition(HUT.x, floorY, HUT.z));
            group.add(new THREE.Mesh(applyBoxUV(peg), M.get('weatheredTimber')));
        }
    }
    /* ---------- bench under the window with a sheepskin ---------- */
    const benchGroup = new THREE.Group();
    const benchPick = hitBox(1.1, 0.6, 0.45);
    {
        const wood = M.get('weatheredTimber');
        const bark = new THREE.MeshStandardMaterial({ name: 'birchStump', color: 0xdcd7cd, roughness: 0.85 });
        const hd = HUT.d / 2;
        const seatY = 0.44;
        const lz = hd + 0.36;
        const x0 = -1.12;
        const x1 = -0.08;
        const local = [];
        // two birch stumps and a half-log seat
        for (const lx of [x0 + 0.16, x1 - 0.16]) {
            const g = new THREE.CylinderGeometry(0.11, 0.12, seatY - 0.06, 12);
            g.translate(lx, (seatY - 0.06) / 2 - 0.05, lz);
            applyBoxUV(g, { grain: 'y' });
            local.push(g);
            g.userData.mat = bark;
        }
        const seat = new THREE.CylinderGeometry(0.15, 0.15, x1 - x0, 14, 1, false, Math.PI / 2, Math.PI);
        seat.rotateZ(Math.PI / 2);
        seat.rotateX(Math.PI);
        seat.translate((x0 + x1) / 2, seatY - 0.06, lz);
        applyBoxUV(seat, { grain: 'x' });
        seat.userData.mat = wood;
        local.push(seat);
        const top = new THREE.BoxGeometry(x1 - x0, 0.02, 0.3);
        top.translate((x0 + x1) / 2, seatY - 0.05, lz);
        applyBoxUV(top, { grain: 'x' });
        top.userData.mat = wood;
        local.push(top);
        // a sheepskin thrown over one end
        const skin = new THREE.BoxGeometry(0.55, 0.05, 0.5, 6, 1, 6);
        {
            const pos = skin.getAttribute('position');
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i);
                const z = pos.getZ(i);
                let y = pos.getY(i);
                // drapes over the front edge
                if (z > 0.12)
                    y -= (z - 0.12) * 1.4;
                y += 0.012 * Math.sin(x * 23 + z * 17);
                pos.setXYZ(i, x, y, Math.min(z, 0.2 + (z - 0.2) * 0.3));
            }
            skin.computeVertexNormals();
        }
        skin.translate(x0 + 0.38, seatY + 0.0, lz + 0.03);
        applyBoxUV(skin);
        skin.userData.mat = new THREE.MeshPhysicalMaterial({ name: 'benchSheepskin', color: 0xeee6d4, roughness: 1, sheen: 1, sheenRoughness: 0.5, sheenColor: 0xf3ebd8 });
        local.push(skin);
        const world = new THREE.Matrix4().makeRotationY(HUT.rotY).setPosition(HUT.x, floorY - 0.18 + 0.05, HUT.z);
        for (const g of local) {
            g.applyMatrix4(world);
            const mesh = new THREE.Mesh(g, g.userData.mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            benchGroup.add(mesh);
        }
        const c = hut.toWorld((x0 + x1) / 2, 0, lz);
        circles.push({ x: c.x, z: c.z, r: 0.35, yMax: floorY + 0.4 });
        benchPick.position.set(c.x, floorY - 0.18 + 0.3, c.z);
        benchPick.rotation.y = HUT.rotY;
    }
    group.add(benchGroup);
    /* ---------- wax torches by the boardwalk ---------- */
    const torchGroup = new THREE.Group();
    {
        const stick = new THREE.MeshStandardMaterial({ name: 'torchStick', color: 0x3b2a1e, roughness: 0.9 });
        const wax = new THREE.MeshStandardMaterial({ name: 'torchWax', color: 0x2a1610, roughness: 0.55 });
        wax.userData.snow = 0;
        TORCHES.forEach(([x, z], i) => {
            const y = heightAt(x, z);
            const h = 0.82 + i * 0.06;
            const lean = (i ? -1 : 1) * 0.05;
            const g = new THREE.CylinderGeometry(0.016, 0.02, h + 0.3, 7);
            g.translate(0, (h - 0.3) / 2, 0);
            g.rotateZ(lean);
            g.translate(x, y, z);
            applyBoxUV(g, { grain: 'y' });
            torchGroup.add(new THREE.Mesh(g, stick));
            // the wax torch: four twisted wicks in a fat cylinder of wax
            const w = new THREE.CylinderGeometry(0.045, 0.038, 0.26, 9);
            w.translate(0, h + 0.1, 0);
            w.rotateZ(lean);
            w.translate(x, y, z);
            applyBoxUV(w, { grain: 'y' });
            torchGroup.add(new THREE.Mesh(w, wax));
            const tip = new THREE.Vector3(0, h + 0.24, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), lean);
            flames.push({ x: x + tip.x, y: y + tip.y, z, size: 0.42 });
            circles.push({ x, z, r: 0.06, yMax: y + 1.3 });
        });
    }
    group.add(torchGroup);
    /* ---------- the sign ---------- */
    const signGroup = new THREE.Group();
    const signPick = hitBox(1.0, 0.6, 0.15);
    {
        const y = heightAt(SIGN.x, SIGN.z);
        const yaw = Math.atan2(SIGN.fx, SIGN.fz);
        const frame = new THREE.Matrix4().makeRotationY(yaw).setPosition(SIGN.x, y, SIGN.z);
        const wood = M.get('weatheredTimber');
        const BW = 0.92;
        const BH = 0.46;
        const BY = 1.02;
        const local = [];
        for (const sx of [-1, 1]) {
            const p = new THREE.BoxGeometry(0.07, BY + BH / 2 + 0.35, 0.07);
            p.translate(sx * (BW / 2 - 0.05), (BY + BH / 2 - 0.35) / 2 + 0.02, -0.05);
            applyBoxUV(p, { grain: 'y' });
            local.push([p, wood]);
        }
        const board = new THREE.BoxGeometry(BW, BH, 0.035);
        board.translate(0, BY, 0);
        applyBoxUV(board, { grain: 'x' });
        local.push([board, wood]);
        const face = new THREE.PlaneGeometry(BW - 0.03, BH - 0.03);
        face.translate(0, BY, 0.0185);
        const faceMat = new THREE.MeshStandardMaterial({ name: 'springSign', map: signTexture(), roughness: 0.85 });
        faceMat.userData.snow = 0;
        local.push([face, faceMat]);
        // a cap board with a ridge of snow
        const cap = new THREE.BoxGeometry(BW + 0.08, 0.035, 0.09);
        cap.translate(0, BY + BH / 2 + 0.02, 0);
        applyBoxUV(cap, { grain: 'x' });
        local.push([cap, wood]);
        const snow = snowCap(cap.clone(), { thickness: 0.07, cell: 0.015, overhang: 0.03, lumps: 0.4, seed: 23 });
        if (snow)
            local.push([snow, M.get('snowPack')]);
        for (const [g, m] of local) {
            g.applyMatrix4(frame);
            const mesh = new THREE.Mesh(g, m);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            signGroup.add(mesh);
        }
        circles.push({ x: SIGN.x, z: SIGN.z, r: 0.5, yMax: y + 1.4 });
        signPick.position.set(SIGN.x, y + 1.0, SIGN.z);
        signPick.rotation.y = yaw;
    }
    group.add(signGroup);
    return { group, hut, glow, flames, signPick, benchPick, circles };
}
