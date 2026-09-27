import { defineConfig } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, 'src')
// Every src/<dir>/index.html is a page; src/index.html is the hub.
const pages = ['.', ...readdirSync(root)].filter(d => existsSync(resolve(root, d, 'index.html')))

export default defineConfig({
  root,
  base: './', // relative URLs: the same build works under /games/, on a custom domain, or on itch.io
  appType: 'mpa', // dev server 404s unknown paths like Pages does, instead of serving the hub
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rolldownOptions: {
      input: Object.fromEntries(pages.map(d => [d === '.' ? 'hub' : d, resolve(root, d, 'index.html')])),
    },
  },
})
