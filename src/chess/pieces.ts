// The pieces, drawn for this game as SVG symbols on a 100 × 100 grid. Each piece element
// uses one with <use href="#p2">; the fill, outline and detail colors come from CSS, so one
// drawing serves both sides.
const base = '<rect x="21" y="79" width="58" height="10" rx="4"/>'

const SHAPES: Record<number, string> = {
  1: `${base}<path d="M35 79c3-8 6-17 7-27h16c1 10 4 19 7 27z"/><rect x="34" y="45" width="32" height="8" rx="4"/><circle cx="50" cy="32" r="12.5"/>`,
  2: `${base}<path d="M30 79c0-11 4-19 13-26-6 0-13 3-19 8-6-3-7-9-3-14 8-9 13-16 16-26l-1-10 9 7c16-1 27 12 28 30 1 12-4 20-4 31z"/><path class="d" d="M57 25c8 7 12 17 12 29"/><circle class="e" cx="44" cy="33" r="3"/>`,
  3: `${base}<path d="M37 79c3-6 5-12 5-17h16c0 5 2 11 5 17z"/><rect x="33" y="56" width="34" height="8" rx="4"/><path d="M50 18c-14 11-19 25-13 38h26c6-13 1-27-13-38z"/><circle cx="50" cy="13" r="5.5"/><path class="d" d="M56 30l-9 12"/>`,
  4: `${base}<rect x="26" y="70" width="48" height="9" rx="2"/><path d="M32 70l3-32h30l3 32z"/><path d="M27 40V17h9v7h9v-7h10v7h9v-7h9v23z"/><path class="d" d="M35 40h30"/>`,
  5: `${base}<path d="M28 79l-8-45 12 22 3-30 9 26 6-30 6 30 9-26 3 30 12-22-8 45z"/><rect x="26" y="69" width="48" height="10" rx="3"/><circle cx="20" cy="31" r="5"/><circle cx="35" cy="23" r="5"/><circle cx="50" cy="18" r="5"/><circle cx="65" cy="23" r="5"/><circle cx="80" cy="31" r="5"/>`,
  6: `${base}<path d="M30 79c-6-15-9-31 3-37 8-4 14 0 17 7 3-7 9-11 17-7 12 6 9 22 3 37z"/><path d="M40 44c0-16 20-16 20 0z"/><rect x="26" y="69" width="48" height="10" rx="3"/><path d="M46 6h8v7h7v8h-7v11h-8V21h-7v-8h7z"/>`,
}

export const SPRITES = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(SHAPES)
  .map(([k, d]) => `<symbol id="p${k}" viewBox="0 0 100 100">${d}</symbol>`)
  .join('')}</svg>`

export const pieceSvg = (kind: number) => `<svg viewBox="0 0 100 100"><use href="#p${kind}"/></svg>`
