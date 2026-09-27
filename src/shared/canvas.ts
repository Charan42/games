// Keeps `canvas` at the largest board of square cells (cols × rows) that fits its parent,
// and calls redraw after every resize. Game code draws in CSS pixels: cell × cols wide.
export function fitCanvas(canvas: HTMLCanvasElement, cols: number, rows: number, redraw: () => void) {
  const view = { ctx: canvas.getContext('2d')!, cell: 0 }
  const parent = canvas.parentElement!
  new ResizeObserver(() => {
    view.cell = Math.max(1, Math.floor(Math.min(parent.clientWidth / cols, parent.clientHeight / rows)))
    // ponytail: capped at 2x; 3x phone screens cost 2.25x the pixels for little visible gain
    const dpr = Math.min(devicePixelRatio, 2)
    canvas.style.width = `${view.cell * cols}px`
    canvas.style.height = `${view.cell * rows}px`
    canvas.width = Math.round(view.cell * cols * dpr)
    canvas.height = Math.round(view.cell * rows * dpr)
    view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    redraw()
  }).observe(parent)
  return view
}
