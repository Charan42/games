import { instantiate, type Engine } from './engine.ts'

// The computer thinks here, off the main thread, so the page stays responsive. Each request
// carries the whole game from the start, which lets the engine see repetitions; the worker
// keeps nothing between requests but its hash table.
export interface Request { id: number; moves: number[]; ms: number; depth: number; noise: number; seed: number }
export interface Reply { id: number; move: number; depth: number; score: number; nodes: number }

const scope = self as unknown as { onmessage: (e: MessageEvent) => void; postMessage(reply: Reply): void }
let engine: Promise<Engine> | undefined

// The first message is the compiled module, so the .wasm file is only downloaded once.
scope.onmessage = async ({ data }: MessageEvent<WebAssembly.Module | Request>) => {
  if (data instanceof WebAssembly.Module) {
    engine = instantiate(data)
    return
  }
  const e = await engine!
  e.reset()
  for (const m of data.moves) e.play(m)
  const move = e.think(data.ms, data.depth, data.noise, data.seed)
  scope.postMessage({ id: data.id, move, depth: e.last_depth(), score: e.last_score(), nodes: e.last_nodes() })
}
