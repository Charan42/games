// The 3D world: a rail yard at dusk. Everything is simple shapes with canvas-drawn textures,
// so the game downloads no images or models.
import {
  BackSide, BoxGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group,
  HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Scene, SphereGeometry,
  TorusGeometry, type Material,
} from 'three'
import { LANE_W, SIZES, type Obstacle, type PowerKind } from './logic.ts'

export const SKY_TOP = '#2e1a4f'
export const HORIZON = '#f59e6b'

function canvasTexture(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void, color = true) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  paint(canvas.getContext('2d')!)
  const t = new CanvasTexture(canvas)
  if (color) t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

// --- Scenery ---------------------------------------------------------------------------------

export function makeScene() {
  const scene = new Scene()
  scene.background = canvasTexture(2, 256, c => {
    const g = c.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, SKY_TOP)
    g.addColorStop(0.55, '#c2477a')
    g.addColorStop(0.8, '#f0775e')
    g.addColorStop(1, HORIZON)
    c.fillStyle = g
    c.fillRect(0, 0, 2, 256)
  })
  scene.fog = new Fog(HORIZON, 70, 185)
  scene.add(new HemisphereLight('#ffd9c7', '#4a2f5c', 1.4))
  const sun = new DirectionalLight('#fff0dc', 2.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 14, bottom: -14, near: 1, far: 60 })
  sun.shadow.bias = -0.0015
  scene.add(sun, sun.target)
  return { scene, sun }
}

// A low sun on the horizon, always straight ahead.
export function makeSunDisc() {
  const disc = new Mesh(new CircleGeometry(26, 48), new MeshBasicMaterial({ color: '#ffd8a0', fog: false }))
  const glow = new Mesh(new CircleGeometry(44, 48), new MeshBasicMaterial({ color: '#ffb480', transparent: true, opacity: 0.35, fog: false }))
  glow.position.z = -1
  const g = new Group()
  g.add(glow, disc)
  return g
}

// The ground, the lanes' gravel beds, rails and sleepers. Rails and beds are long enough to
// move with the runner; the sleepers repeat every SLEEPER m, so they only shift in steps.
export const SLEEPER = 1.2
export function makeTrack() {
  const track = new Group()
  const ground = new Mesh(new PlaneGeometry(260, 320), new MeshLambertMaterial({ color: '#3b2a4a' }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.02
  ground.receiveShadow = true
  track.add(ground)

  const moving = new Group() // beds and rails: follow the runner exactly
  const bed = new MeshLambertMaterial({ color: '#6e5d78' })
  const rail = new MeshStandardMaterial({ color: '#d8d2e2', metalness: 0.7, roughness: 0.35 })
  for (const lane of [-1, 0, 1]) {
    const b = new Mesh(new BoxGeometry(2.1, 0.12, 260), bed)
    b.position.set(lane * LANE_W, 0.0, -100)
    b.receiveShadow = true
    moving.add(b)
    for (const side of [-0.55, 0.55]) {
      const r = new Mesh(new BoxGeometry(0.09, 0.12, 260), rail)
      r.position.set(lane * LANE_W + side, 0.14, -100)
      moving.add(r)
    }
  }
  track.add(moving)

  const count = Math.ceil(240 / SLEEPER)
  const sleepers = new InstancedMesh(new BoxGeometry(1.9, 0.08, 0.28), new MeshLambertMaterial({ color: '#5b4331' }), count * 3)
  const m = new Matrix4()
  let k = 0
  for (let i = 0; i < count; i++) for (const lane of [-1, 0, 1]) sleepers.setMatrixAt(k++, m.makeTranslation(lane * LANE_W, 0.08, 20 - i * SLEEPER))
  sleepers.receiveShadow = true
  track.add(sleepers)
  return { track, ground, moving, sleepers }
}

// Buildings beside the track, in three heights so their windows keep their proportions.
// Slots every BLOCK m on each side; which building stands in a slot comes from a hash of the
// slot's number, so the skyline is the same every time you pass.
export const BLOCK = 9
const SLOTS = 26
const FACADES = ['#6d5a8c', '#8a5a7a', '#5a6b8c', '#7a6a5a', '#94637a', '#5d7a86']
export function makeCity() {
  const heights = [8, 14, 22]
  const floors = heights.map(h => Math.round(h / 2.4))
  const kinds = heights.map((h, i) => {
    const map = canvasTexture(64, 16 * floors[i], c => {
      c.fillStyle = '#d9d4e4'
      c.fillRect(0, 0, 64, 16 * floors[i])
      for (let f = 0; f < floors[i]; f++) for (let w = 0; w < 4; w++) {
        c.fillStyle = '#2a2238'
        c.fillRect(6 + w * 15, 4 + f * 16, 9, 9)
      }
    })
    const glow = canvasTexture(64, 16 * floors[i], c => {
      c.fillStyle = '#000'
      c.fillRect(0, 0, 64, 16 * floors[i])
      c.fillStyle = '#ffcf7a'
      for (let f = 0; f < floors[i]; f++) for (let w = 0; w < 4; w++) if ((f * 7 + w * 13 + i * 5) % 5 < 2) c.fillRect(6 + w * 15, 4 + f * 16, 9, 9)
    })
    const mat = new MeshLambertMaterial({ map, emissive: '#ffffff', emissiveMap: glow, emissiveIntensity: 0.9 })
    const mesh = new InstancedMesh(new BoxGeometry(7, h, 7), mat, SLOTS * 2)
    mesh.castShadow = false
    return mesh
  })
  const group = new Group()
  group.add(...kinds)
  const m = new Matrix4()
  const color = new Color()
  let shown = NaN
  // Refill the slots when the runner has moved on by a block.
  function place(d: number) {
    const first = Math.floor(d / BLOCK) - 3
    if (first === shown) return
    shown = first
    const used = [0, 0, 0]
    for (let j = 0; j < SLOTS; j++) {
      const slot = first + j
      for (const side of [-1, 1]) {
        const h = hash(slot * 2 + (side > 0 ? 1 : 0))
        if (h < 0.12) continue // a gap now and then
        const kind = Math.floor(h * 97) % 3
        const mesh = kinds[kind]
        const x = side * (11 + ((h * 31) % 1) * 5)
        m.makeTranslation(x, heights[kind] / 2, -slot * BLOCK)
        mesh.setMatrixAt(used[kind], m)
        mesh.setColorAt(used[kind], color.set(FACADES[Math.floor(h * 131) % FACADES.length]))
        used[kind]++
      }
    }
    kinds.forEach((mesh, i) => {
      mesh.count = used[i]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  }
  return { group, place }
}
const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

// Poles with a lamp along both edges of the yard.
export function makePoles() {
  const count = 16
  const poles = new InstancedMesh(new BoxGeometry(0.18, 5.4, 0.18), new MeshLambertMaterial({ color: '#3a3148' }), count * 2)
  const lamps = new InstancedMesh(new BoxGeometry(0.5, 0.18, 0.3), new MeshBasicMaterial({ color: '#ffe8b0' }), count * 2)
  const m = new Matrix4()
  const place = (d: number) => {
    const first = Math.floor(d / 16) - 1
    let k = 0
    for (let j = 0; j < count; j++) {
      for (const side of [-1, 1]) {
        const z = -(first + j) * 16
        poles.setMatrixAt(k, m.makeTranslation(side * 4.6, 2.7, z))
        lamps.setMatrixAt(k, m.makeTranslation(side * 4.3, 5.3, z))
        k++
      }
    }
    poles.instanceMatrix.needsUpdate = lamps.instanceMatrix.needsUpdate = true
  }
  const group = new Group()
  group.add(poles, lamps)
  return { group, place }
}

// --- Things on the track ----------------------------------------------------------------------

const stripes = (a: string, b: string) =>
  canvasTexture(128, 32, c => {
    c.fillStyle = a
    c.fillRect(0, 0, 128, 32)
    c.fillStyle = b
    for (let x = -32; x < 128; x += 32) {
      c.beginPath()
      c.moveTo(x, 32)
      c.lineTo(x + 16, 32)
      c.lineTo(x + 32, 0)
      c.lineTo(x + 16, 0)
      c.fill()
    }
  })
const crate = canvasTexture(64, 64, c => {
  c.fillStyle = '#b07a44'
  c.fillRect(0, 0, 64, 64)
  c.strokeStyle = '#6b4523'
  c.lineWidth = 6
  c.strokeRect(3, 3, 58, 58)
  c.beginPath()
  c.moveTo(6, 6)
  c.lineTo(58, 58)
  c.stroke()
})
const TRAIN_COLORS = ['#1f9e89', '#e0663a', '#3b6fd4', '#c23b6b', '#d9a521']
const trainSide = canvasTexture(128, 64, c => {
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, 128, 64)
  c.fillStyle = '#1b2233'
  for (let x = 6; x < 128; x += 32) c.fillRect(x, 14, 22, 18)
  c.fillStyle = 'rgb(0 0 0 / 0.25)'
  c.fillRect(0, 44, 128, 4)
})
trainSide.wrapS = RepeatWrapping

const mats = {
  post: new MeshLambertMaterial({ color: '#d4d4d8' }),
  low: new MeshLambertMaterial({ map: stripes('#f8fafc', '#dc2626') }),
  high: new MeshLambertMaterial({ map: stripes('#facc15', '#1c1917') }),
  crate: new MeshLambertMaterial({ map: crate }),
  front: new MeshLambertMaterial({ color: '#1b2233' }),
  light: new MeshBasicMaterial({ color: '#fff6c2' }),
}
const geo = {
  post: new BoxGeometry(0.12, 1, 0.12),
  board: new BoxGeometry(1.95, 0.42, 0.14),
  crate: new BoxGeometry(1.7, 1.3, 1.4),
  lamp: new BoxGeometry(0.3, 0.2, 0.05),
}

function shadowy(o: Object3D) {
  o.traverse(c => {
    if (c instanceof Mesh) c.castShadow = true
  })
  return o
}

// A mesh for an obstacle, with its origin at the obstacle's near end (logic z) on the ground.
export function makeObstacle(o: Obstacle) {
  const g = new Group()
  const post = (x: number, h: number) => {
    const p = new Mesh(geo.post, mats.post)
    p.scale.y = h
    p.position.set(x, h / 2, -0.25)
    g.add(p)
  }
  if (o.kind === 'low') {
    post(-0.85, 0.95)
    post(0.85, 0.95)
    const board = new Mesh(geo.board, mats.low)
    board.position.set(0, SIZES.low.height - 0.25, -0.25)
    g.add(board)
  } else if (o.kind === 'high') {
    post(-0.9, 2.2)
    post(0.9, 2.2)
    const board = new Mesh(geo.board, mats.high)
    board.scale.y = 1.3
    board.position.set(0, SIZES.high.height + 0.3, -0.25)
    g.add(board)
  } else if (o.kind === 'block') {
    const a = new Mesh(geo.crate, mats.crate)
    a.position.set(0, 0.65, -0.7)
    const b = new Mesh(geo.crate, mats.crate)
    b.position.set(0.05, 1.95, -0.7)
    b.rotation.y = 0.15
    g.add(a, b)
  } else {
    const color = TRAIN_COLORS[o.id % TRAIN_COLORS.length]
    const side = trainSide.clone()
    side.repeat.x = o.len / 4
    const body = new MeshLambertMaterial({ color, map: side })
    const plain = new MeshLambertMaterial({ color })
    // Box faces: +x, -x, +y, -y, +z (toward the runner), -z.
    const car = new Mesh(new BoxGeometry(2.1, 3, o.len), [body, body, plain, plain, mats.front, plain])
    car.position.set(0, 1.62, -o.len / 2)
    g.add(car)
    for (const x of [-0.6, 0.6]) {
      const lamp = new Mesh(geo.lamp, mats.light)
      lamp.position.set(x, 0.7, 0.03)
      g.add(lamp)
    }
    const roof = new Mesh(new BoxGeometry(1.7, 0.25, o.len - 1), plain)
    roof.position.set(0, 3.22, -o.len / 2)
    g.add(roof)
  }
  g.position.x = o.lane * LANE_W
  return shadowy(g)
}

export function disposeObstacle(g: Object3D) {
  g.traverse(c => {
    if (!(c instanceof Mesh)) return
    const shared = Object.values(geo).includes(c.geometry)
    if (!shared) c.geometry.dispose()
    for (const m of [c.material].flat() as Material[]) if (!Object.values(mats).includes(m as never)) m.dispose()
  })
}

export function makeCoins(max: number) {
  const g = new CylinderGeometry(0.34, 0.34, 0.09, 20)
  g.rotateX(Math.PI / 2)
  const mesh = new InstancedMesh(g, new MeshStandardMaterial({ color: '#fbbf24', metalness: 0.55, roughness: 0.3, emissive: '#7a4d00', emissiveIntensity: 0.6 }), max)
  mesh.castShadow = true
  mesh.frustumCulled = false
  return mesh
}

const POWER_COLORS: Record<PowerKind, string> = { magnet: '#ef4444', shield: '#38bdf8', double: '#4ade80' }
export function makePower(kind: PowerKind) {
  const g = new Group()
  const color = POWER_COLORS[kind]
  const mat = new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.6 })
  if (kind === 'magnet') {
    const u = new Mesh(new TorusGeometry(0.34, 0.12, 10, 24, Math.PI), mat)
    u.rotation.z = Math.PI
    const tips = new MeshLambertMaterial({ color: '#e5e7eb' })
    for (const x of [-0.34, 0.34]) {
      const t = new Mesh(new BoxGeometry(0.24, 0.2, 0.24), tips)
      t.position.set(x, 0.08, 0)
      g.add(t)
    }
    g.add(u)
  } else if (kind === 'shield') {
    g.add(new Mesh(new IcosahedronGeometry(0.42, 1), new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.8 })))
  } else {
    const box = new Mesh(new BoxGeometry(0.62, 0.62, 0.62), mat)
    const label = canvasTexture(64, 64, c => {
      c.fillStyle = color
      c.fillRect(0, 0, 64, 64)
      c.fillStyle = '#052e16'
      c.font = '900 34px system-ui, sans-serif'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText('×2', 32, 34)
    })
    box.material = new MeshLambertMaterial({ map: label, emissive: color, emissiveIntensity: 0.35 })
    g.add(box)
  }
  // A soft halo so it reads from far away.
  const halo = new Mesh(new SphereGeometry(0.75, 16, 12), new MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: BackSide, depthWrite: false }))
  g.add(halo)
  return shadowy(g)
}

// --- The runner -------------------------------------------------------------------------------

export function makeRunner() {
  const skin = new MeshLambertMaterial({ color: '#e9b98f' })
  const hoodie = new MeshLambertMaterial({ color: '#2563eb' })
  const pants = new MeshLambertMaterial({ color: '#1e293b' })
  const shoes = new MeshLambertMaterial({ color: '#f8fafc' })
  const cap = new MeshLambertMaterial({ color: '#ef4444' })
  const box = (w: number, h: number, d: number, mat: Material, x: number, y: number, z: number) => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    return m
  }
  const root = new Group() // at the runner's feet
  const body = new Group() // tilts back to slide
  const hips = new Group()
  hips.position.y = 0.92
  body.add(hips)
  root.add(body)
  hips.add(box(0.56, 0.66, 0.34, hoodie, 0, 0.36, 0))
  const head = new Group()
  head.position.y = 0.9
  head.add(box(0.36, 0.38, 0.36, skin, 0, 0.02, 0), box(0.4, 0.14, 0.4, cap, 0, 0.2, 0), box(0.3, 0.05, 0.2, cap, 0, 0.14, -0.26))
  hips.add(head)
  const limb = (x: number, y: number, len: number, mat: Material, end: Material | null) => {
    const pivot = new Group()
    pivot.position.set(x, y, 0)
    pivot.add(box(0.16, len, 0.16, mat, 0, -len / 2, 0))
    if (end) pivot.add(box(0.2, 0.12, 0.3, end, 0, -len - 0.02, -0.05))
    hips.add(pivot)
    return pivot
  }
  const armL = limb(-0.37, 0.64, 0.56, hoodie, null)
  const armR = limb(0.37, 0.64, 0.56, hoodie, null)
  for (const arm of [armL, armR]) arm.add(box(0.14, 0.14, 0.14, skin, 0, -0.62, 0))
  const legL = limb(-0.15, 0.02, 0.8, pants, shoes)
  const legR = limb(0.15, 0.02, 0.8, pants, shoes)
  shadowy(root)

  const bubble = new Mesh(new SphereGeometry(1.25, 24, 16), new MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.22, depthWrite: false }))
  bubble.position.y = 1
  bubble.visible = false
  root.add(bubble)

  // Poses the runner for a moment: running (phase advances with distance), in the air, or
  // rolling under a bar (roll runs 0 to 1 through the slide; -1 when not sliding).
  function pose(phase: number, air: boolean, roll: number, lean: number) {
    const s = Math.sin(phase)
    if (roll >= 0) {
      // Tucked into a ball, turning one forward somersault.
      body.position.set(0, 0.5, 0)
      body.rotation.set(-roll * Math.PI * 2, 0, lean)
      hips.position.y = -0.3
      hips.rotation.x = -0.6
      legL.rotation.x = legR.rotation.x = 2
      armL.rotation.x = armR.rotation.x = 1.5
      return
    }
    body.position.set(0, 0, 0)
    body.rotation.set(0, 0, lean)
    hips.position.y = 0.92
    if (air) {
      legL.rotation.x = 1.1
      legR.rotation.x = 0.2
      armL.rotation.x = armR.rotation.x = 2.7
      hips.rotation.x = 0
    } else {
      legL.rotation.x = s * 0.95
      legR.rotation.x = -s * 0.95
      armL.rotation.x = -s * 0.9
      armR.rotation.x = s * 0.9
      hips.position.y += Math.abs(Math.cos(phase)) * 0.07
      hips.rotation.x = -0.12 // leaning into the run
    }
  }
  return { root, pose, bubble }
}

// Bits that fly off when something breaks.
export function makeDebris(max: number) {
  const mesh = new InstancedMesh(new BoxGeometry(0.22, 0.22, 0.22), new MeshLambertMaterial({ color: '#ffffff' }), max)
  mesh.frustumCulled = false
  mesh.count = 0
  return mesh
}
