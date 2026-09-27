import type { GameMeta } from './shared/types.ts'

// Every game folder is picked up at build time: no list to maintain.
const metas = import.meta.glob<GameMeta>('./*/meta.ts', { eager: true, import: 'default' })
const thumbs = import.meta.glob<string>('./*/thumb.webp', { eager: true, import: 'default' })

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

// A stable color per game, for cards without a thumbnail.
const hue = (slug: string) => [...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)

const cards = Object.entries(metas)
  .map(([path, meta]) => ({ slug: path.split('/')[1], meta, thumb: thumbs[path.replace('meta.ts', 'thumb.webp')] }))
  .filter(({ meta }) => import.meta.env.DEV || !meta.wip)
  .sort((a, b) => b.meta.added.localeCompare(a.meta.added))
  .map(({ slug, meta, thumb }) => `
    <li><a class="card" href="./${slug}/">
      <span class="thumb" style="--hue: ${hue(slug)}">${
        thumb ? `<img src="${thumb}" alt="" width="512" height="512" loading="lazy">` : esc(meta.title)
      }</span>
      <span class="info">
        <strong>${esc(meta.title)}${meta.wip ? ' <small>wip</small>' : ''}</strong>
        <span>${esc(meta.blurb)}</span>
      </span>
    </a></li>`)

document.querySelector('#games')!.innerHTML = cards.join('') || '<li class="empty">No games yet.</li>'
