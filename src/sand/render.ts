// WebGL2 renderer for the sandbox. Each frame the simulation hands over four bytes per cell
// (element, shade, heat, aux; see render() in crate/src/lib.rs) and three passes turn them
// into pixels:
//   1. scene: each cell's material color, lit like a relief from the top left, plus what it
//      gives off as light (flames, lava, anything red-hot) into a second buffer
//   2. bloom: that light blurred down a chain of half-size buffers and added back up
//   3. screen: the scene scaled up crisp, lit by the bloom, shimmering above hot spots

const VERTEX = `#version 300 es
out vec2 uv;
void main() {
  // One triangle that covers the viewport; uv runs 0..1 across it.
  vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0;
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const COMMON = `#version 300 es
precision highp float;
precision highp int;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
`

// Element ids, as in crate/src/lib.rs.
const SCENE =
  COMMON +
  `
precision highp usampler2D;
uniform usampler2D cells;
uniform float time;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outLight; // rgb: light given off; a: heat, for the shimmer

const uint EMPTY = 0u, WALL = 1u, SAND = 2u, WATER = 3u, WOOD = 4u, FIRE = 5u, PLANT = 6u, LAVA = 7u,
  OIL = 8u, SMOKE = 9u, STEAM = 10u, EMBER = 11u, STONE = 12u, GLASS = 13u, ICE = 14u;

ivec2 size;
uvec4 at(ivec2 p) {
  // Outside the grid is wall, like in the simulation.
  if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return uvec4(WALL, 0u, 8u, 0u);
  return texelFetch(cells, p, 0);
}
bool airy(uint k) { return k == EMPTY || k == FIRE || k == SMOKE || k == STEAM; }
float solid(ivec2 p) { return airy(at(p).x) ? 0.0 : 1.0; }
bool liquid(uint k) { return k == WATER || k == OIL || k == LAVA; }

// Glowing-metal colors: dull red at 500 °C, orange, then yellow-white.
vec3 blackbody(float t) {
  float x = clamp((t - 450.0) / 1100.0, 0.0, 1.0);
  return vec3(1.0, 0.18 + 0.75 * x * x, 0.04 + 0.55 * x * x * x) * (0.25 + 1.3 * x);
}

vec3 background(vec2 p) {
  vec3 c = mix(vec3(0.028, 0.032, 0.05), vec3(0.06, 0.056, 0.075), p.y / float(size.y));
  return c + (noise(p * 0.07) - 0.5) * 0.012;
}

// How deep a liquid cell sits under the surface, in cells, up to 24.
float depth(ivec2 p, uint k) {
  for (int i = 1; i <= 24; i++) {
    if (at(p - ivec2(0, i)).x != k) return float(i - 1);
  }
  return 24.0;
}

void main() {
  size = textureSize(cells, 0);
  ivec2 p = ivec2(gl_FragCoord.xy); // row 0 is the top row of the grid
  vec2 f = vec2(p);
  uvec4 c = at(p);
  uint k = c.x;
  float shade = float(c.y) / 255.0;
  float temp = float(c.z) * 8.0 - 50.0;
  float aux = float(c.w);
  vec3 bg = background(f);
  vec3 col = bg;
  vec3 light = vec3(0);
  float haze = clamp((temp - 70.0) / 400.0, 0.0, 1.0);

  if (airy(k)) {
    if (k == FIRE) {
      // Young flames burn yellow-white, old ones deep red.
      float t = clamp(aux / 36.0, 0.0, 1.0) * (0.75 + 0.5 * noise(f * 0.4 + vec2(0.0, time * 9.0)));
      vec3 flame = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.82, 0.35), t);
      col = mix(bg, flame, 0.9);
      light = flame * (0.8 + t);
    } else if (k == SMOKE) {
      float a = clamp(aux / 70.0, 0.0, 1.0) * (0.45 + 0.35 * noise(f * 0.25 + vec2(time * 0.7, time * 1.3)));
      col = mix(bg, vec3(0.2, 0.2, 0.23), a);
    } else if (k == STEAM) {
      float a = 0.25 + 0.25 * noise(f * 0.3 + vec2(time * 0.9, time * 1.7));
      col = mix(bg, vec3(0.78, 0.84, 0.9), a);
    } else {
      // Empty. Anything falling fast leaves a short trail above it, like motion blur, so a
      // pour reads as a stream rather than dots.
      for (int i = 1; i <= 4; i++) {
        uvec4 below = at(p + ivec2(0, i));
        if (!airy(below.x) && float(below.w) >= 20.0 * float(i)) {
          vec3 tint = below.x == WATER ? vec3(0.3, 0.62, 0.98)
            : below.x == SAND ? vec3(0.85, 0.72, 0.45)
            : below.x == LAVA ? blackbody(1300.0)
            : below.x == OIL ? vec3(0.3, 0.2, 0.1) : vec3(0.3);
          col = mix(bg, tint, 0.5 / float(i + 1));
          break;
        }
        if (!airy(below.x)) break;
      }
      col += vec3(0.05, 0.02, 0.0) * haze; // hot air
    }
    outColor = vec4(col, 1);
    outLight = vec4(light, haze);
    return;
  }

  // Everything else is lit like a relief: the edge between material and air is a slope, facing
  // the light (top left) or away from it. Sampled two cells out, so edges get a soft bevel.
  vec2 g = vec2(0);
  for (int r = 1; r <= 2; r++) {
    float w = r == 1 ? 1.0 : 0.5;
    g.x += w * (solid(p + ivec2(r, 0)) - solid(p - ivec2(r, 0)));
    g.y += w * (solid(p + ivec2(0, r)) - solid(p - ivec2(0, r)));
    g += w * 0.5 * (solid(p + ivec2(r, r)) - solid(p - ivec2(r, r))) * vec2(1, 1);
    g += w * 0.5 * (solid(p + ivec2(r, -r)) - solid(p - ivec2(r, -r))) * vec2(1, -1);
  }
  vec3 n = normalize(vec3(-g * 0.45, 1.0)); // grid y points down, so -g.y faces up
  vec3 toLight = normalize(vec3(-0.45, -0.75, 0.6));
  float diffuse = clamp(dot(n, toLight) / toLight.z, 0.35, 1.6);
  float spec = pow(max(dot(n, normalize(toLight + vec3(0, 0, 1))), 0.0), 24.0);
  // Cells deep inside a mass are a bit darker than ones near its surface.
  float open = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 d = vec2(cos(float(i) * 0.785), sin(float(i) * 0.785)) * 4.0;
    open += 1.0 - solid(p + ivec2(d));
  }
  float ao = 0.8 + 0.2 * min(open / 3.0, 1.0);

  vec3 base = vec3(1, 0, 1);
  float gloss = 0.0, clear = 0.0; // clear: how much of the background shows through
  bool shaded = true;
  bool top = airy(at(p - ivec2(0, 1)).x);

  if (k == SAND) {
    base = mix(vec3(0.93, 0.79, 0.49), vec3(0.8, 0.63, 0.37), shade);
    if (shade > 0.93) base *= 0.72; // a few dark grains
    base += min(aux, 40.0) * 0.002; // dust kicked up when it moves
  } else if (k == STONE) {
    base = mix(vec3(0.34, 0.31, 0.3), vec3(0.2, 0.19, 0.2), shade);
    if (shade > 0.9) base += 0.1;
  } else if (k == WALL) {
    // Bricks, eight cells by four, every other row offset.
    vec2 b = f / vec2(8.0, 4.0);
    b.x += mod(floor(b.y), 2.0) * 0.5;
    vec2 m = fract(b);
    float mortar = step(m.x, 0.125) + step(m.y, 0.25);
    base = vec3(0.38, 0.39, 0.44) * (0.85 + 0.3 * hash(floor(b))) * (0.92 + 0.16 * noise(f * 0.5));
    base = mix(base, vec3(0.2, 0.21, 0.24), min(mortar, 1.0));
  } else if (k == WOOD) {
    // Planks with grain running along them.
    float grain = fract(f.y * 0.22 + noise(vec2(f.x * 0.06, f.y * 0.5)) * 1.6);
    base = mix(vec3(0.5, 0.32, 0.17), vec3(0.34, 0.2, 0.1), smoothstep(0.2, 0.9, grain));
    base *= 0.9 + 0.2 * hash(vec2(floor(f.y / 5.0), 3.0));
  } else if (k == PLANT) {
    base = mix(vec3(0.18, 0.6, 0.24), vec3(0.4, 0.78, 0.3), shade);
    if (top) base += vec3(0.08, 0.12, 0.02);
  } else if (k == WATER || k == OIL) {
    float d = depth(p, k);
    float wave = sin(f.x * 0.35 + time * 2.2 + f.y * 0.4) * sin(f.x * 0.13 - time * 1.3);
    if (k == WATER) {
      base = mix(vec3(0.24, 0.6, 0.98), vec3(0.03, 0.14, 0.42), smoothstep(0.0, 22.0, d));
      base += 0.04 * wave;
      base = mix(base, vec3(0.85, 0.93, 1.0), clamp((aux - 16.0) / 80.0, 0.0, 0.5)); // foam
      clear = 0.22;
    } else {
      base = mix(vec3(0.34, 0.24, 0.12), vec3(0.14, 0.09, 0.05), smoothstep(0.0, 16.0, d));
      if (d < 1.0) base += 0.18 * (0.5 + 0.5 * cos(6.28 * (f.x * 0.04 + time * 0.1 + vec3(0.0, 0.33, 0.67)))); // oily sheen
      clear = 0.08;
    }
    if (d < 1.0) base = mix(base, vec3(0.9, 0.96, 1.0), 0.3); // the surface catches the light
    gloss = 0.6;
    diffuse = mix(1.0, diffuse, 0.4);
  } else if (k == LAVA) {
    float churn = noise(f * 0.12 + vec2(time * 0.25, time * 0.1)) + 0.5 * noise(f * 0.3 - time * 0.4);
    base = blackbody(temp) * (0.55 + 0.6 * churn);
    light = base * 0.9;
    shaded = false;
  } else if (k == EMBER) {
    // Charred wood with glowing cracks that breathe.
    float crack = pow(noise(f * 0.6 + vec2(time * 0.8, -time)), 2.0);
    vec3 fire = vec3(1.0, 0.33, 0.06) * (0.35 + 1.3 * crack) * clamp(aux / 50.0 + 0.3, 0.0, 1.0);
    base = vec3(0.1, 0.06, 0.04) + fire;
    light = fire * 0.9;
    shaded = false;
  } else if (k == GLASS) {
    base = vec3(0.62, 0.8, 0.8);
    clear = 0.7;
    gloss = 1.0;
  } else if (k == ICE) {
    base = mix(vec3(0.78, 0.92, 1.0), vec3(0.62, 0.82, 0.95), shade);
    base += 0.1 * step(0.94, noise(f * 0.35)); // frosty streaks
    clear = 0.25;
    gloss = 0.8;
  }

  col = base;
  if (shaded) col *= diffuse * ao;
  col = mix(col, bg, clear) + spec * gloss * 0.35;

  // Anything hot enough glows (lava already does).
  if (k != LAVA && k != EMBER && temp > 450.0) {
    vec3 hot = blackbody(temp) * smoothstep(450.0, 1100.0, temp);
    col += hot;
    light += hot * 0.7;
  }
  outColor = vec4(col, 1);
  outLight = vec4(light, haze);
}`

// Dual-filter blur (Marius Bjørge, 2015): cheap and wide.
const DOWN =
  COMMON +
  `
uniform sampler2D src;
in vec2 uv;
out vec4 frag;
void main() {
  vec2 t = 1.0 / vec2(textureSize(src, 0));
  frag = (texture(src, uv) * 4.0 + texture(src, uv + t * vec2(-1, -1)) + texture(src, uv + t * vec2(1, -1)) +
    texture(src, uv + t * vec2(-1, 1)) + texture(src, uv + t * vec2(1, 1))) / 8.0;
}`

const UP =
  COMMON +
  `
uniform sampler2D src;
in vec2 uv;
out vec4 frag;
void main() {
  vec2 t = 1.0 / vec2(textureSize(src, 0));
  frag = (texture(src, uv + t * vec2(-2, 0)) + texture(src, uv + t * vec2(2, 0)) + texture(src, uv + t * vec2(0, -2)) +
    texture(src, uv + t * vec2(0, 2)) + 2.0 * (texture(src, uv + t * vec2(-1, -1)) + texture(src, uv + t * vec2(1, -1)) +
    texture(src, uv + t * vec2(-1, 1)) + texture(src, uv + t * vec2(1, 1)))) / 12.0;
}`

const SCREEN =
  COMMON +
  `
uniform sampler2D scene, bloom;
uniform float time;
in vec2 uv;
out vec4 frag;
void main() {
  vec2 grid = vec2(textureSize(scene, 0));
  vec2 t = vec2(uv.x, 1.0 - uv.y); // the screen is y-up, the grid y-down
  vec4 b = texture(bloom, t);
  vec3 light = b.rgb * 0.45;
  // Heat haze: the picture wobbles over hot spots.
  float haze = min(b.a * 0.6, 1.0);
  vec2 wobble = vec2(sin(t.y * grid.y * 0.8 + time * 7.0), sin(t.x * grid.x * 0.6 + t.y * grid.y * 0.3 + time * 5.0));
  vec3 col = texture(scene, t + wobble * haze * 0.9 / grid).rgb;
  col = col * (1.0 + light * 2.0) + light * 0.7; // light falls on what's nearby, and blooms
  col *= 1.0 - 0.3 * smoothstep(0.35, 0.85, length(t - 0.5)); // vignette
  vec3 over = max(col - 0.8, 0.0);
  col = min(col, 0.8) + 0.2 * (1.0 - exp(-over / 0.2)); // roll off highlights instead of clipping
  frag = vec4(col + (hash(gl_FragCoord.xy + fract(time)) - 0.5) / 255.0, 1); // dither away banding
}`

export function createRenderer(canvas: HTMLCanvasElement, W: number, H: number) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  if (!gl) return null
  // Half-float buffers let the bloom add up past 1.0; plain bytes clip it but still work.
  const hdr = !!gl.getExtension('EXT_color_buffer_float')
  const [format, type] = hdr ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE]

  function program(fragment: string) {
    const p = gl!.createProgram()
    for (const [kind, src] of [
      [gl!.VERTEX_SHADER, VERTEX],
      [gl!.FRAGMENT_SHADER, fragment],
    ] as const) {
      const s = gl!.createShader(kind)!
      gl!.shaderSource(s, src)
      gl!.compileShader(s)
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) ?? 'shader')
      gl!.attachShader(p, s)
    }
    gl!.linkProgram(p)
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(p) ?? 'link')
    return p
  }
  function texture(w: number, h: number, internal: number, fmt: number, t: number, filter: number) {
    const tex = gl!.createTexture()
    gl!.bindTexture(gl!.TEXTURE_2D, tex)
    gl!.texImage2D(gl!.TEXTURE_2D, 0, internal, w, h, 0, fmt, t, null)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    return { tex, w, h, fbo: null as WebGLFramebuffer | null }
  }
  function target(t: ReturnType<typeof texture>, ...more: ReturnType<typeof texture>[]) {
    t.fbo = gl!.createFramebuffer()
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, t.fbo)
    ;[t, ...more].forEach((a, i) => gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0 + i, gl!.TEXTURE_2D, a.tex, 0))
    gl!.drawBuffers([t, ...more].map((_, i) => gl!.COLOR_ATTACHMENT0 + i))
    return t
  }

  const scene = program(SCENE)
  const down = program(DOWN)
  const up = program(UP)
  const screen = program(SCREEN)
  const u = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name)

  const cells = texture(W, H, gl.RGBA8UI, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, gl.NEAREST)
  const color = texture(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST)
  const glow = texture(W, H, format, gl.RGBA, type, gl.LINEAR)
  target(color, glow)
  // Bloom chain: 1/2, 1/4 … 1/32 of the grid.
  const chain = [1, 2, 3, 4, 5].map(i =>
    target(texture(Math.max(1, W >> i), Math.max(1, H >> i), format, gl.RGBA, type, gl.LINEAR)),
  )
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

  function pass(p: WebGLProgram, to: { fbo: WebGLFramebuffer | null; w: number; h: number }, src?: WebGLTexture) {
    gl!.useProgram(p)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, to.fbo)
    gl!.viewport(0, 0, to.w, to.h)
    if (src) {
      gl!.activeTexture(gl!.TEXTURE0)
      gl!.bindTexture(gl!.TEXTURE_2D, src)
    }
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
  }

  return function draw(view: Uint8Array, seconds: number) {
    gl.disable(gl.BLEND)
    gl.bindTexture(gl.TEXTURE_2D, cells.tex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, view)
    gl.useProgram(scene)
    gl.uniform1f(u(scene, 'time'), seconds)
    pass(scene, color, cells.tex)

    let src = glow
    for (const level of chain) {
      pass(down, level, src.tex)
      src = level
    }
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE) // each level adds its blur onto the next bigger one
    for (let i = chain.length - 1; i > 0; i--) pass(up, chain[i - 1], chain[i].tex)
    gl.disable(gl.BLEND)

    gl.useProgram(screen)
    gl.uniform1i(u(screen, 'scene'), 0)
    gl.uniform1i(u(screen, 'bloom'), 1)
    gl.uniform1f(u(screen, 'time'), seconds)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, chain[0].tex)
    pass(screen, { fbo: null, w: canvas.width, h: canvas.height }, color.tex)
  }
}
