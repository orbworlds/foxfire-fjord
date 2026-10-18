/**
 * Load order matters: structures register colliders/reservations before
 * vegetation scatters around them, so grass and flora come last.
 */
export const FEATURE_REGISTRY = [
    { id: 'terrain', label: 'Shaping the island', load: () => import('./terrain/index.js') },
    { id: 'ocean', label: 'Freezing the fjord', load: () => import('./ocean/index.js') },
    { id: 'house', label: 'Raising the cabin', load: () => import('./house/index.js') },
    { id: 'interior', label: 'Lighting the stove', load: () => import('./interior/index.js') },
    { id: 'village', label: 'Lighting the windows of Lysvik', load: () => import('./village/index.js') },
    { id: 'spring', label: 'Warming the hot spring', load: () => import('./spring/index.js') },
    { id: 'peak', label: 'Building the cairn on Fox Peak', load: () => import('./peak/index.js') },
    { id: 'lake', label: 'Augering holes in Mirror Lake', load: () => import('./lake/index.js') },
    { id: 'paths', label: 'Setting stepping stones', load: () => import('./paths/index.js') },
    { id: 'beach', label: 'Stranding the ice', load: () => import('./beach/index.js') },
    { id: 'flora', label: 'Growing the spruce woods', load: () => import('./flora/index.js') },
    { id: 'grass', label: 'Combing the lyme grass', load: () => import('./grass/index.js') },
    { id: 'fox', label: 'Waking the fox', load: () => import('./fox/index.js') },
    { id: 'weather', label: 'Raising the spindrift', load: () => import('./weather/index.js') },
];
