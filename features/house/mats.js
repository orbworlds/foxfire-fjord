/**
 * The cabin's palette, fetched once from the material library: near-black
 * tarred board-and-batten outside with white painted trims and a fieldstone
 * plinth and chimney; honey pine panelling, pine floors and wool inside.
 * Interior variants are lit by their room's lamps and stove (zones `living`
 * and `glasswing`).
 */
import * as THREE from 'three';
export function cabinMats(ctx) {
    const M = ctx.materials;
    const deck = M.get('weatheredTimber');
    const curtain = M.get('linen', 'living').clone();
    curtain.name = 'cabinCurtain';
    curtain.side = THREE.DoubleSide;
    curtain.color.set(0xf3e6cf);
    curtain.emissive.set(0xffc490);
    M.registerInterior(curtain, 'living', { nightEnv: 0.35 });
    M.registerNightGlow(curtain, 0.045, 'living');
    // the wing's frame: oiled spruce glulam, a shade deeper than the panelling so the glass reads as
    // glass (the panelling's boards run along each member like glulam laminations; no new texture)
    const frame = M.get('knottyPine').clone();
    frame.name = 'wingFrame';
    frame.color.set(0xc79a70);
    frame.roughness = 0.75;
    M.registerInterior(frame, 'glasswing', { nightEnv: 0.35 });
    // walls: the same pine panelling washed with lime, the grain and the knots still showing through
    const limed = (zone) => {
        const w = M.get('knottyPine').clone();
        w.name = `limedPine@${zone}`;
        w.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.76, 0.69) * (0.62 + 0.75 * lum), 0.78);
        }`);
        };
        w.customProgramCacheKey = () => 'fox-limed-1';
        M.registerInterior(w, zone, { nightEnv: 0.35 });
        return w;
    };
    // a honed dark stone for the hearth and the chimney's cap (plain: no texture to bake)
    const hearthStone = new THREE.MeshStandardMaterial({ name: 'hearthStone', color: 0x3a3c40, roughness: 0.55 });
    const hearthIn = hearthStone.clone();
    hearthIn.name = 'hearthStone@living';
    M.registerInterior(hearthIn, 'living', { nightEnv: 0.35 });
    const wallIn = limed('living');
    const wallW = limed('glasswing');
    return {
        clad: M.get('tarredWood'),
        roof: M.get('tarredWood'),
        trim: M.get('whiteTrim'),
        stone: M.get('fieldstone'),
        slate: hearthStone,
        steel: M.get('blackSteel'),
        iron: M.get('castIron'),
        snow: M.get('snowPack'),
        ice: M.get('ice'),
        deck,
        timber: M.get('weatheredTimber'),
        pine: M.get('knottyPine', 'living'),
        pineW: M.get('knottyPine', 'glasswing'),
        wallIn,
        wallW,
        floor: M.get('pineFloor', 'living'),
        floorW: M.get('pineFloor', 'glasswing'),
        stoneIn: M.get('fieldstone', 'living'),
        slateIn: hearthIn,
        trimIn: M.get('whiteTrim', 'living'),
        frame,
        glass: M.glass({ frost: 0.85, room: 'living', opacity: 0.045, reflect: 1.3, tint: 0xe4ece8 }),
        glassW: M.glass({ frost: 0.68, snow: 1.1, room: 'glasswing', opacity: 0.03, reflect: 1.5, tint: 0xdfe9e6 }),
        curtain,
    };
}
