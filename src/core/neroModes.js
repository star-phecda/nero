export const NERO_MODES = Object.freeze({
  NORMAL: 'normal',
  GOD: 'god',
  MOON_CELL: 'moon_cell'
});

export const NERO_MODE_PROFILES = Object.freeze({
  [NERO_MODES.NORMAL]: Object.freeze({
    name: 'NORMAL',
    modelTier: 'normal',
    planning: false,
    expandedContext: false,
    tools: true
  }),
  [NERO_MODES.GOD]: Object.freeze({
    name: 'GOD',
    modelTier: 'strong',
    planning: true,
    expandedContext: true,
    tools: true
  }),
  [NERO_MODES.MOON_CELL]: Object.freeze({
    name: 'MOON CELL',
    modelTier: 'strong',
    planning: true,
    expandedContext: true,
    tools: true
  })
});

export function normalizeNeroMode(value) {
  const mode = String(value || '').trim().toLowerCase();

  if (mode === NERO_MODES.GOD) return NERO_MODES.GOD;
  if (mode === NERO_MODES.MOON_CELL || mode === 'mooncell' || mode === 'moon-cell') {
    return NERO_MODES.MOON_CELL;
  }

  return NERO_MODES.NORMAL;
}
