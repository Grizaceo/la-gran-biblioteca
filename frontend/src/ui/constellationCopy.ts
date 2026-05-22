/** Shared user-facing copy for constellation (experimental) mode. */
export const CONSTELLATION_EXPERIMENTAL = ' (experimental)'

export const CONSTELLATION_MENU_LABEL = `Constelaciones${CONSTELLATION_EXPERIMENTAL}`

export const CONSTELLATION_PANEL_TITLE = `Constelaciones${CONSTELLATION_EXPERIMENTAL}`

export function constellationLayoutMenuLabel(on: boolean): string {
  return `Disposición en constelaciones${CONSTELLATION_EXPERIMENTAL} (${on ? 'ON' : 'OFF'})`
}

export const CONSTELLATION_SETTINGS_MENU = `Configuración de constelaciones${CONSTELLATION_EXPERIMENTAL}…`

export const CONSTELLATION_RELAYOUT_MENU = `Recalcular layout astral${CONSTELLATION_EXPERIMENTAL}`

export const CONSTELLATION_DETAIL_SECTION = `Constelación${CONSTELLATION_EXPERIMENTAL}`

export const CONSTELLATION_INTRO_NOTE =
  'Funcionalidad en prueba; el layout puede cambiar.'

export const CONSTELLATION_LAYOUT_TOGGLE = `Usar disposición en constelaciones${CONSTELLATION_EXPERIMENTAL}`

export const CONSTELLATION_RECALC_BTN = `Recalcular layout${CONSTELLATION_EXPERIMENTAL}`

export const BANNER_LAYOUT_ON_NO_CONFIRMED =
  'Confirma al menos una carpeta (p. ej. desde el detalle de la carpeta) y pulsa Recalcular.'

export const TOAST_CONFIRM_WITHOUT_LAYOUT =
  `Activa disposición en constelaciones${CONSTELLATION_EXPERIMENTAL} para ver el mapa.`

export const TOAST_LAYOUT_ON_ACTIVATED = `Disposición en constelaciones${CONSTELLATION_EXPERIMENTAL} activada`

export const TOAST_TREE_LAYOUT = 'Layout de árbol (predeterminado)'

export const TOAST_ENABLE_LAYOUT_FIRST =
  `Activa primero la disposición en constelaciones${CONSTELLATION_EXPERIMENTAL}`

export const TOAST_RELAYOUT_OK = `Layout astral recalculado${CONSTELLATION_EXPERIMENTAL}`
