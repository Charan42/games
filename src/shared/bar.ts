import type { GameMeta } from './types.ts'

const icon = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`

// The top bar on every game page: back to the hub, title, full screen, how to play.
// onPause runs when the help dialog opens, so real-time games can pause behind it.
export function mountBar(meta: GameMeta, onPause?: () => void) {
  const bar = document.createElement('header')
  bar.className = 'bar'
  bar.innerHTML = `
    <a href="../" aria-label="All games">${icon('M15 5l-7 7 7 7')}<span class="wide">All games</span></a>
    <h1></h1>
    <button type="button" data-fullscreen aria-label="Full screen">${icon('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5')}</button>
    <button type="button" data-help aria-label="How to play">${icon('M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01')}</button>`
  bar.querySelector('h1')!.textContent = meta.title
  document.body.prepend(bar)

  const full = bar.querySelector<HTMLButtonElement>('[data-fullscreen]')!
  // iPhone Safari has no Fullscreen API, and an installed app is already full screen.
  full.hidden = !document.fullscreenEnabled || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
  full.onclick = () =>
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})

  const help = document.createElement('dialog')
  help.innerHTML = '<h2></h2><p></p><p><strong>How to play:</strong> <span></span></p><form method="dialog"><button class="btn">Got it</button></form>'
  help.querySelector('h2')!.textContent = meta.title
  help.querySelector('p')!.textContent = meta.blurb
  help.querySelector('span')!.textContent = meta.controls
  document.body.append(help)
  bar.querySelector<HTMLButtonElement>('[data-help]')!.onclick = () => {
    onPause?.()
    help.showModal()
  }
}
