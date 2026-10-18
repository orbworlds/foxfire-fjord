export function terrainConfig(q) {
    const d = q.terrainDetail;
    const gridN = d >= 1 ? 64 : d >= 0.75 ? 48 : 32;
    const nodeSize0 = 64;
    const fineSpacing = nodeSize0 / gridN;
    // the fine window spans ~512 m around the camera at every quality
    const fineN = d >= 1 ? 512 : d >= 0.75 ? 384 : 256;
    return {
        gridN,
        nodeSize0,
        levels: 8,
        rootX: -4096,
        rootZ: -5120,
        rootSize: 8192,
        range0: nodeSize0 * (d >= 1 ? 3.0 : d >= 0.75 ? 2.9 : 2.85),
        morphStart: 0.7,
        fineSpacing,
        fineN,
        fineTile: 32,
        maxNodes: 512,
        tier: d >= 1 ? 2 : d >= 0.75 ? 1 : 0,
    };
}
