import type { FeatureEntry } from '../core/loader';

/**
 * Load order matters: structures register colliders/reservations before
 * vegetation scatters around them, so grass and flora come last.
 */
export const FEATURE_REGISTRY: FeatureEntry[] = [
  { id: 'terrain', label: 'Shaping the island', load: () => import('./terrain') },
  { id: 'ocean', label: 'Freezing the fjord', load: () => import('./ocean') },
  { id: 'house', label: 'Raising the cabin', load: () => import('./house') },
  { id: 'interior', label: 'Lighting the stove', load: () => import('./interior') },
  { id: 'village', label: 'Lighting the windows of Lysvik', load: () => import('./village') },
  { id: 'spring', label: 'Warming the hot spring', load: () => import('./spring') },
  { id: 'peak', label: 'Building the cairn on Fox Peak', load: () => import('./peak') },
  { id: 'lake', label: 'Augering holes in Mirror Lake', load: () => import('./lake') },
  { id: 'paths', label: 'Setting stepping stones', load: () => import('./paths') },
  { id: 'beach', label: 'Stranding the ice', load: () => import('./beach') },
  { id: 'flora', label: 'Growing the spruce woods', load: () => import('./flora') },
  { id: 'grass', label: 'Combing the lyme grass', load: () => import('./grass') },
  { id: 'fox', label: 'Waking the fox', load: () => import('./fox') },
  { id: 'weather', label: 'Raising the spindrift', load: () => import('./weather') },
];
