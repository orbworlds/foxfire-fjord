/**
 * URL parameters owned by Foxfire Fjord's interface (core params live in core/params.ts):
 *   ?tour=3        start the guided tour at stop 3 (1-based) once loaded; instant in shot mode
 *   ?intro=1       force the opening sequence (even with view= / shot)
 *   ?map=1|2|0     1 = show the corner map, 2 = open the island map, 0 = hide the corner map
 *   ?help=1        open the controls overlay
 *   ?settings=1    open the settings panel
 *   ?touch=1       force the touch interface (virtual joystick in walk mode)
 *   ?demo=about,places,sky,sheet,walkhint,toast,tooltip   UI fixtures for screenshots (comma-separated;
 *                  'card' is an alias of 'about')
 */
const sp = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

function int(name: string): number | null {
  const v = sp.get(name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export const uiParams = {
  tour: int('tour'),
  intro: sp.get('intro') === '1',
  map: int('map'),
  help: sp.get('help') === '1',
  settings: sp.get('settings') === '1',
  touch: sp.get('touch') === '1',
  demo: (sp.get('demo') ?? '').split(',').filter(Boolean),
};
