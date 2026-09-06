/**
 * studio-gpu-bristle WGSL kernels — the ONLY module in this lane carrying shader text.
 *
 * PROVENANCE (derived work, MIT):
 *   David Li, "Fluid Paint" — http://david.li/paint — https://github.com/dli/paint
 *   Copyright (c) 2017 David Li. MIT License. Verbatim permission notice checked in at
 *   'third_party/dli-paint/LICENSE' and embedded into
 *   'dist/legal/THIRD_PARTY_NOTICES.generated.md' by 'scripts/generate-third-party-notices.mjs'.
 *
 *   Upstream files this module is derived from:
 *     - 'brush.js' (bristle chain layout, Verlet projection, constraint iteration order)
 *     - 'shaders/project.frag'            → the integrate step of 'bristle_solve'
 *     - 'shaders/distanceconstraint.frag' → 'solve_distance_edges' (red/black split preserved)
 *     - 'shaders/bendingconstraint.frag'  → 'solve_bending'
 *     - 'shaders/planeconstraint.frag'    → 'solve_plane'
 *     - 'shaders/setbristles.frag'        → the root pin in 'bristle_solve'
 *     - 'shaders/updatevelocity.frag'     → the 'prev = old' write-back
 *     - 'shaders/splat.frag'              → 'distance_to_segment' capsule weight in the deposit pass
 *     - 'shaders/painting.frag'           → Sobel height→normal, GGX + Smith visibility + Schlick
 *                                           fresnel, wrapped diffuse, and the Gossett & Chen RYB
 *                                           cube, in 'impasto_resolve'
 *
 * Adaptations, stated so the CPU twin can reproduce them exactly:
 *   1. dli ping-pongs six fragment passes twenty times because a 2017 fragment shader cannot write
 *      an arbitrary address. There are no inter-bristle constraints in the model (distance, bending
 *      and plane are all intra-chain), so one compute invocation owns one whole bristle and runs
 *      every iteration in a serial loop. The red/black edge split is preserved anyway, because the
 *      solve order is part of the numeric contract the CPU reference reproduces.
 *   2. One capsule per (bristle, station), from the chain's contact point BEFORE the station is
 *      integrated to its contact point AFTER. The previous contact is therefore recomputed from
 *      persisted state rather than stored, which is what makes an incremental suffix solve
 *      bit-identical to a from-scratch replay (gate G1).
 *   3. Splat slots are addressed deterministically ('bristle * maxStationsPerBatch + station').
 *      There are no atomics anywhere in this lane; atomic append would randomise blend order.
 *
 * Numeric-tunable rule (the rule that keeps the oracle honest, mirroring
 * 'studio-living-ink-execution-protocol.ts:17-20'): NO physics or display tunable is ever written
 * inside shader text. Gravity, damping, stiffness variation, bristle length, jitter, iteration
 * count, NORMAL_SCALE, roughness, F0, the specular/diffuse scales and the RYB cube all arrive
 * through uniforms. Structural sizes (vertices per bristle, slot capacity, workgroup width) are
 * interpolated from the caller's layout, never typed as literals here.
 * 'studio-gpu-bristle-browser-boundary.test.ts' enforces both halves mechanically.
 *
 * Bundle rule: this module is reachable only from 'studio-gpu-bristle.worker.ts'.
 * 'studio-gpu-bristle-route-import-boundary.test.ts' fails the build if it becomes reachable from
 * a durable render surface.
 */

import { studioWebGpuR8GrainNativeWgsl } from "./studio-webgpu-r8-grain-native";

import type { StudioWebGpuR8GrainWgslBindings } from "./studio-webgpu-r8-grain-native";

export const STUDIO_GPU_BRISTLE_WGSL_VERSION = "studio-gpu-bristle-wgsl-v1" as const;

/**
 * Pass order. 'bristle-solve' advances persistent chain state and fills the deterministic splat
 * slots; 'splat-deposit' additively blends those capsules into the paint + height targets;
 * 'impasto-resolve' shades the height field per pixel and presents.
 */
export const STUDIO_GPU_BRISTLE_WGSL_PASS_ORDER = Object.freeze([
  "bristle-solve",
  "splat-deposit",
  "impasto-resolve",
] as const);

export type StudioGpuBristleWgslPassId =
  (typeof STUDIO_GPU_BRISTLE_WGSL_PASS_ORDER)[number];

/** Structural sizes only — every one of these changes a buffer layout, none of them is a tunable. */
export interface StudioGpuBristleWgslLayout {
  readonly verticesPerBristle: number;
  readonly maxBristles: number;
  readonly maxStationsPerBatch: number;
  readonly solveWorkgroupSize: number;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validLayout(layout: StudioGpuBristleWgslLayout): boolean {
  return (
    isPositiveInteger(layout.verticesPerBristle)
    && layout.verticesPerBristle >= 2
    && isPositiveInteger(layout.maxBristles)
    && isPositiveInteger(layout.maxStationsPerBatch)
    && isPositiveInteger(layout.solveWorkgroupSize)
    && layout.solveWorkgroupSize >= layout.maxBristles
  );
}

/**
 * Shared struct declarations. 'Bristle' is '2 × verticesPerBristle' vec4 lanes plus one param lane,
 * so at the contract's ten vertices it is exactly 336 bytes (21 × 16) with no implicit padding.
 * 'vec3f' is avoided everywhere — array stride 16 with size 12 is the classic WGSL trap.
 */
function structDeclarations(layout: StudioGpuBristleWgslLayout): string {
  return `
struct Tuft {
  counts   : vec4u,
  physics  : vec4f,
  geometry : vec4f,
  head     : vec4f,
};

struct Station {
  pose  : vec4f,
  drive : vec4f,
};

struct Bristle {
  pos    : array<vec4f, ${layout.verticesPerBristle}>,
  prev   : array<vec4f, ${layout.verticesPerBristle}>,
  params : vec4f,
};

struct Splat {
  seg     : vec4f,
  pigment : vec4f,
  shape   : vec4f,
};
`.trim();
}

/**
 * P1 — persistent PBD chain solve.
 *
 * This kernel is a literal transcription of 'studio-gpu-bristle-reference.ts'
 * ('stepBristle' + the station loop of 'advanceStudioGpuBristleReference'), in the same order,
 * with the same guards. The reference is f64 and this is f32, so the two diverge chaotically over
 * twenty Gauss-Seidel sweeps — which is exactly why the cross-language gates (G3) are statistical
 * and the byte-exact gate (G1) is GPU-vs-GPU. What must NOT diverge is the sequence of operations,
 * so anything the reference changes here has to change too.
 *
 * One invocation owns one bristle's 336-byte slice. Nothing is read from a neighbour, so there is
 * no ping-pong, no barrier, and no 336-byte private copy that would spill to scratch memory at the
 * full workgroup width.
 */
export function studioGpuBristleSolveWgsl(
  layout: StudioGpuBristleWgslLayout,
): string | null {
  if (!validLayout(layout)) return null;
  return `
${structDeclarations(layout)}

/**
 * Pass-local uniforms. Tuft is the shared contract block and has no room for the lane's own
 * transport and deposition tunables, so they travel here. Every value still originates in
 * studio-gpu-bristle-contract.ts; none is written in shader text.
 */
struct Deposit {
  // placeTuft (0/1), unused, unused, unused
  flags     : vec4u,
  // ink R, ink Y, ink B, initial load
  ink       : vec4f,
  // bendStiffnessRatio, capillaryRate, depletionRate, minSplatRadiusPx
  transport : vec4f,
  // splatRadius, splatVelocityScale, thinMinAlpha, thinMaxAlpha
  splat     : vec4f,
};

@group(0) @binding(0) var<uniform> u : Tuft;
@group(0) @binding(1) var<storage, read> stations : array<Station>;
@group(0) @binding(2) var<storage, read_write> bristles : array<Bristle>;
@group(0) @binding(3) var<storage, read_write> splats : array<Splat>;
@group(0) @binding(4) var<uniform> deposit : Deposit;
/** Per-bristle layout draw: offsetX, offsetY, directionX, directionY. */
@group(0) @binding(5) var<storage, read> draws : array<vec4f>;

const VERTICES : u32 = ${layout.verticesPerBristle}u;
/** solveDistance no-op guard — the reference's !(distance > 1e-9). */
const DISTANCE_EPSILON : f32 = 1e-9;

fn clamp01(value : f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

/**
 * reference solveDistance. Vertex 0 is pinned to the ferrule and carries zero inverse mass, so
 * an edge that touches it corrects only its far endpoint.
 */
fn solve_distance(lane : u32, a : u32, b : u32, rest : f32, stiffness : f32) {
  let pa = bristles[lane].pos[a];
  let pb = bristles[lane].pos[b];
  let delta = pb.xyz - pa.xyz;
  let dist = length(delta);
  if (!(dist > DISTANCE_EPSILON)) { return; }
  var weight_a = 1.0;
  if (a == 0u) { weight_a = 0.0; }
  let total = weight_a + 1.0;
  let correction = ((dist - rest) / dist) * stiffness;
  if (weight_a > 0.0) {
    let share = (weight_a / total) * correction;
    bristles[lane].pos[a] = vec4f(pa.xyz + delta * share, pa.w);
  }
  let share_b = correction / total;
  let pb_now = bristles[lane].pos[b];
  bristles[lane].pos[b] = vec4f(pb_now.xyz - delta * share_b, pb_now.w);
}

/**
 * reference placeTuft — straight down until the plane, then straight out along the hair's own
 * radial direction. Path length is preserved edge-for-edge except on the single straddling edge,
 * which the first constraint sweep repairs.
 */
fn place_bristle(lane : u32, head : vec3f, length_scale : f32, ink_load : f32) {
  let draw = draws[lane];
  let hair_length = u.geometry.x * u.geometry.z * length_scale;
  let root = vec2f(head.x + draw.x, head.y + draw.y);
  for (var v = 0u; v < VERTICES; v = v + 1u) {
    let t = f32(v) / (f32(VERTICES) - 1.0);
    let straight_z = head.z - t * hair_length;
    var buckle = 0.0;
    if (straight_z < 0.0) { buckle = -straight_z; }
    let z = max(straight_z, 0.0);
    let p = vec4f(root.x + draw.z * buckle, root.y + draw.w * buckle, z, ink_load);
    bristles[lane].pos[v] = p;
    bristles[lane].prev[v] = p;
  }
}

@compute @workgroup_size(${layout.solveWorkgroupSize})
fn bristle_solve(@builtin(local_invocation_index) lane : u32) {
  let bristle_count = u.counts.x;
  if (lane >= bristle_count) { return; }

  let iterations = u.counts.z;
  let station_count = u.counts.w;

  let ms_to_seconds = u.physics.x;
  let gravity = u.physics.y;
  let damping = u.physics.z;

  let bristle_length = u.geometry.x;
  let base_radius = u.geometry.z;
  let z_threshold = u.geometry.w;
  let brush_height = u.head.z;

  let bend_ratio = deposit.transport.x;
  let capillary_rate = deposit.transport.y;
  let depletion_rate = deposit.transport.z;
  let min_splat_radius = deposit.transport.w;
  let splat_radius = deposit.splat.x;
  let splat_velocity_scale = deposit.splat.y;
  let thin_min_alpha = deposit.splat.z;
  let thin_max_alpha = deposit.splat.w;

  let params = bristles[lane].params;
  let stiffness = params.x;
  let length_scale = params.y;
  let rest = params.w;
  let bend_stiffness = stiffness * bend_ratio;
  let draw = draws[lane];
  let band = z_threshold * base_radius;
  let tip = VERTICES - 1u;

  for (var s = 0u; s < station_count; s = s + 1u) {
    let st = stations[s];
    let pressure = clamp01(st.pose.z);
    let dt = st.pose.w * ms_to_seconds;
    let tilt = st.drive.xy;
    // drive.z carries the host's windowed peak speed (reference pushSpeed), in px/s.
    let filtered_speed = st.drive.z;

    let head_z = (bristle_length - brush_height * pressure) * base_radius;
    // A tilted ferrule leans by the tilt angle over its own height; no new constant is needed.
    let head = vec3f(st.pose.x + tilt.x * head_z, st.pose.y + tilt.y * head_z, head_z);

    if (s == 0u && deposit.flags.x == 1u) {
      place_bristle(lane, head, length_scale, deposit.ink.w);
    }

    let gravity_step = gravity * dt * dt;

    // 1. project.frag — Verlet integrate every free vertex, then gravity along -z.
    for (var v = 1u; v < VERTICES; v = v + 1u) {
      let p = bristles[lane].pos[v];
      let q = bristles[lane].prev[v];
      let velocity = (p.xyz - q.xyz) * damping;
      bristles[lane].prev[v] = vec4f(p.xyz, p.w);
      bristles[lane].pos[v] =
        vec4f(p.x + velocity.x, p.y + velocity.y, p.z + velocity.z - gravity_step, p.w);
    }

    // 2. setbristles.frag — pin the root to the ferrule.
    let root_now = bristles[lane].pos[0];
    bristles[lane].prev[0] = root_now;
    bristles[lane].pos[0] = vec4f(head.x + draw.x, head.y + draw.y, head.z, root_now.w);

    // 3. Gauss-Seidel: distance (red/black) -> bending -> plane, iterations times.
    for (var it = 0u; it < iterations; it = it + 1u) {
      for (var parity = 0u; parity < 2u; parity = parity + 1u) {
        for (var edge = parity; edge + 1u < VERTICES; edge = edge + 2u) {
          solve_distance(lane, edge, edge + 1u, rest, stiffness);
        }
      }
      for (var v = 0u; v + 2u < VERTICES; v = v + 1u) {
        solve_distance(lane, v, v + 2u, rest * 2.0, bend_stiffness);
      }
      for (var v = 1u; v < VERTICES; v = v + 1u) {
        let p = bristles[lane].pos[v];
        if (p.z < 0.0) {
          bristles[lane].pos[v] = vec4f(p.x, p.y, 0.0, p.w);
        }
      }
    }

    // 4. Capillary transport, root -> tip only, conservative within the hair.
    for (var v = 0u; v + 1u < VERTICES; v = v + 1u) {
      let from_p = bristles[lane].pos[v];
      let to_p = bristles[lane].pos[v + 1u];
      let flow = (from_p.w - to_p.w) * capillary_rate;
      if (flow > 0.0) {
        bristles[lane].pos[v] = vec4f(from_p.xyz, from_p.w - flow);
        bristles[lane].pos[v + 1u] = vec4f(to_p.xyz, to_p.w + flow);
      }
    }

    let tip_now = bristles[lane].pos[tip];
    let tip_previous = bristles[lane].prev[tip];
    var contact = 0.0;
    if (band > 0.0) {
      contact = clamp01((band - tip_now.z) / band);
    }
    let load = clamp01(tip_now.w);
    if (contact > 0.0) {
      bristles[lane].pos[tip] =
        vec4f(tip_now.xyz, tip_now.w * (1.0 - depletion_rate * contact));
    }

    // Dimensionless: how far the head travelled this station relative to its own radius.
    let normalized_speed = clamp01((filtered_speed * dt) / base_radius);
    let radius = max(
      min_splat_radius,
      splat_radius * base_radius * (1.0 + splat_velocity_scale * normalized_speed),
    );

    var weight = 0.0;
    if (contact > 0.0) {
      weight = thin_min_alpha + (thin_max_alpha - thin_min_alpha) * contact * load;
    }
    var shaped_radius = 0.0;
    if (weight > 0.0) { shaped_radius = radius; }

    // Station-major slot (studioGpuBristleSplatSlot): the emitted sequence is identical whether
    // the caller hands over 3,200 stations at once or one at a time. That is gate G1.
    let slot = s * bristle_count + lane;
    splats[slot] = Splat(
      vec4f(tip_previous.xy, tip_now.xy),
      vec4f(deposit.ink.xyz, weight),
      vec4f(shaped_radius, weight, 0.0, 0.0),
    );
  }
}
`.trim();
}

/**
 * P2 — deterministic capsule deposit. 'draw(6, capacity)': one quad per slot, slots with zero
 * weight collapse outside NDC. Blend is additive on both targets so the pass is order-free in
 * value even though the slot order is already fixed.
 */
export function studioGpuBristleSplatWgsl(
  layout: StudioGpuBristleWgslLayout,
): string | null {
  if (!validLayout(layout)) return null;
  return `
${structDeclarations(layout)}

struct Viewport {
  // originX, originY, pixelsPerUnit, invSurfaceWidth
  origin_scale : vec4f,
  // invSurfaceHeight, unused
  extent       : vec4f,
};

@group(0) @binding(0) var<uniform> vp : Viewport;
@group(0) @binding(1) var<storage, read> splats : array<Splat>;

struct VsOut {
  @builtin(position) clip : vec4f,
  @location(0) doc : vec2f,
  @location(1) @interpolate(flat) seg : vec4f,
  @location(2) @interpolate(flat) pigment : vec4f,
  @location(3) @interpolate(flat) shape : vec4f,
};

struct FsOut {
  @location(0) paint : vec4f,
  @location(1) height : f32,
};

/** splat.frag distanceToLine — capsule distance from a point to a segment. */
fn distance_to_segment(a : vec2f, b : vec2f, p : vec2f) -> f32 {
  let ab = b - a;
  let len = length(ab);
  if (len <= 1e-8) { return distance(p, a); }
  let dir = ab / len;
  let projected = clamp(dot(p - a, dir), 0.0, len);
  return distance(p, a + dir * projected);
}

@vertex
fn splat_vertex(
  @builtin(vertex_index) corner : u32,
  @builtin(instance_index) slot : u32,
) -> VsOut {
  var out : VsOut;
  let s = splats[slot];
  out.seg = s.seg;
  out.pigment = s.pigment;
  out.shape = s.shape;
  if (s.pigment.w <= 0.0 || s.shape.x <= 0.0) {
    out.clip = vec4f(2.0, 2.0, 0.0, 1.0);
    out.doc = vec2f(0.0, 0.0);
    return out;
  }
  let radius = s.shape.x;
  let lo = min(s.seg.xy, s.seg.zw) - vec2f(radius, radius);
  let hi = max(s.seg.xy, s.seg.zw) + vec2f(radius, radius);
  // Two triangles: 0,1,2 / 2,1,3 over (lo, hi).
  var index = corner;
  if (corner == 3u) { index = 2u; }
  if (corner == 4u) { index = 1u; }
  if (corner == 5u) { index = 3u; }
  let doc = vec2f(
    select(lo.x, hi.x, (index & 1u) == 1u),
    select(lo.y, hi.y, (index & 2u) == 2u),
  );
  out.doc = doc;
  let pixels = (doc - vp.origin_scale.xy) * vp.origin_scale.z;
  let ndc = vec2f(
    pixels.x * vp.origin_scale.w * 2.0 - 1.0,
    1.0 - pixels.y * vp.extent.x * 2.0,
  );
  out.clip = vec4f(ndc, 0.0, 1.0);
  return out;
}

@fragment
fn splat_fragment(input : VsOut) -> FsOut {
  var out : FsOut;
  let radius = input.shape.x;
  let d = distance_to_segment(input.seg.xy, input.seg.zw, input.doc);
  // splat.frag falloff: linear to the capsule edge.
  let falloff = max(0.0, 1.0 - d / radius);
  let w = falloff * input.pigment.w;
  out.paint = vec4f(input.pigment.xyz * w, w);
  out.height = input.shape.y * w;
  return out;
}
`.trim();
}

/**
 * P3 — per-pixel impasto resolve. This is the field 'studio-oil-ribbon-carrier.ts' currently
 * computes and then discards into ≤6 vector stripes; here it stays a texture all the way to the
 * presentation surface.
 *
 * Paint and height are read with 'textureLoad' (1:1 integer texels, no sampler) so nothing depends
 * on vendor filter precision. Only the paper grain uses 'textureSample', deliberately: repeat +
 * linear on r8unorm is the one sample this repo already mirrors bit-exactly on the CPU
 * ('sampleStudioWebGpuR8GrainNativeCpu').
 */
export function studioGpuBristleImpastoResolveWgsl(
  grain: StudioWebGpuR8GrainWgslBindings,
): string | null {
  const grainWgsl = studioWebGpuR8GrainNativeWgsl(grain);
  if (!grainWgsl) return null;
  const prefix = grain.prefix ?? "studio_r8_grain";
  return `
struct Display {
  // lightX, lightY, lightZ, normalScale
  light      : vec4f,
  // roughness, f0, specularScale, diffuseScale
  material   : vec4f,
  // maxShadingMultiplier, heightScale, grainOriginU, grainOriginV
  limits     : vec4f,
  // documentOriginX, documentOriginY, documentPerPixel, strokeOpacity
  surface    : vec4f,
  ryb000     : vec4f,
  ryb100     : vec4f,
  ryb010     : vec4f,
  ryb001     : vec4f,
  ryb101     : vec4f,
  ryb011     : vec4f,
  ryb110     : vec4f,
  ryb111     : vec4f,
};

@group(0) @binding(0) var<uniform> d : Display;
@group(0) @binding(1) var paint_tex : texture_2d<f32>;
@group(0) @binding(2) var height_tex : texture_2d<f32>;

${grainWgsl}

/** painting.frag rybToRgb — Gossett & Chen trilinear interpolation over the RYB cube. */
fn ryb_to_rgb(p : vec3f) -> vec3f {
  let c = clamp(p, vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0));
  let i = vec3f(1.0, 1.0, 1.0) - c;
  return d.ryb000.xyz * i.x * i.y * i.z
    + d.ryb100.xyz * c.x * i.y * i.z
    + d.ryb010.xyz * i.x * c.y * i.z
    + d.ryb001.xyz * i.x * i.y * c.z
    + d.ryb101.xyz * c.x * i.y * c.z
    + d.ryb011.xyz * i.x * c.y * c.z
    + d.ryb110.xyz * c.x * c.y * i.z
    + d.ryb111.xyz * c.x * c.y * c.z;
}

fn height_at(coord : vec2i, size : vec2i) -> f32 {
  // CLAMP_TO_EDGE, like painting.frag's texture sampling.
  let c = clamp(coord, vec2i(0, 0), size - vec2i(1, 1));
  return textureLoad(height_tex, c, 0).r * d.limits.y;
}

/** painting.frag GGX(alpha, nDotH) — Trowbridge-Reitz. */
fn ggx_distribution(alpha : f32, n_dot_h : f32) -> f32 {
  let a2 = alpha * alpha;
  let den = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265358979 * den * den);
}

/** painting.frag GGGX(alpha, nDotL, nDotV) — Smith-style joint visibility. */
fn gggx_visibility(alpha : f32, n_dot_l : f32, n_dot_v : f32) -> f32 {
  let a2 = alpha * alpha;
  let gl = n_dot_l + sqrt(a2 + (1.0 - a2) * n_dot_l * n_dot_l);
  let gv = n_dot_v + sqrt(a2 + (1.0 - a2) * n_dot_v * n_dot_v);
  return 1.0 / (gl * gv);
}

/**
 * painting.frag fresnel(F0, lDotH) — Schlick. The fifth power is written as explicit
 * multiplication: WGSL pow lowers to exp2/log2 with vendor-dependent last-ulp behaviour, and
 * this term is inside the ≤1 LSB impasto gate.
 */
fn schlick_fresnel(f0 : f32, l_dot_h : f32) -> f32 {
  let base = 1.0 - l_dot_h;
  let squared = base * base;
  let f = squared * squared * base;
  return (1.0 - f0) * f + f0;
}

/** painting.frag specularBRDF + wrapped diffuse, eye fixed at (0, 0, 1) exactly as upstream. */
fn shade_normal(n : vec3f) -> f32 {
  let light = normalize(d.light.xyz);
  let half_vector = normalize(light + vec3f(0.0, 0.0, 1.0));
  let n_dot_l = clamp(dot(n, light), 0.0, 1.0);
  let n_dot_h = clamp(dot(n, half_vector), 0.0, 1.0);
  let n_dot_v = clamp(n.z, 0.0, 1.0);
  let l_dot_h = clamp(dot(light, half_vector), 0.0, 1.0);
  let roughness = d.material.x;
  let diffuse_scale = d.material.w;
  let diffuse = n_dot_l * diffuse_scale + (1.0 - diffuse_scale);
  let specular = ggx_distribution(roughness, n_dot_h)
    * gggx_visibility(roughness, n_dot_l, n_dot_v)
    * schlick_fresnel(d.material.y, l_dot_h)
    * d.material.z;
  return diffuse + specular;
}

@vertex
fn resolve_vertex(@builtin(vertex_index) index : u32) -> @builtin(position) vec4f {
  // Fullscreen triangle.
  let x = f32((index << 1u) & 2u) * 2.0 - 1.0;
  let y = 1.0 - f32(index & 2u) * 2.0;
  return vec4f(x, y, 0.0, 1.0);
}

@fragment
fn resolve_fragment(@builtin(position) frag : vec4f) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(paint_tex, 0));
  let coord = vec2i(frag.xy);
  let accumulated = textureLoad(paint_tex, clamp(coord, vec2i(0, 0), size - vec2i(1, 1)), 0);
  let coverage = clamp(accumulated.a, 0.0, 1.0);

  let top_left = height_at(coord + vec2i(-1, -1), size);
  let top = height_at(coord + vec2i(0, -1), size);
  let top_right = height_at(coord + vec2i(1, -1), size);
  let left = height_at(coord + vec2i(-1, 0), size);
  let right = height_at(coord + vec2i(1, 0), size);
  let bottom_left = height_at(coord + vec2i(-1, 1), size);
  let bottom = height_at(coord + vec2i(0, 1), size);
  let bottom_right = height_at(coord + vec2i(1, 1), size);

  // painting.frag computeGradient (Sobel), image-space labelling: rows grow downward.
  let gradient_x = top_left - top_right + 2.0 * left - 2.0 * right + bottom_left - bottom_right;
  let gradient_y = top_left + 2.0 * top + top_right - bottom_left - 2.0 * bottom - bottom_right;
  let normal_scale = d.light.w;
  let normal_length = sqrt(
    gradient_x * gradient_x + gradient_y * gradient_y + normal_scale * normal_scale,
  );
  let n = vec3f(gradient_x, gradient_y, normal_scale) / normal_length;

  // Flat paint pins at exactly 1.0 so the multiplier is identity outside relief.
  let flat_shade = shade_normal(vec3f(0.0, 0.0, 1.0));
  let shade = clamp(shade_normal(n) / flat_shade, 0.0, d.limits.x);

  let ryb = accumulated.xyz / max(accumulated.a, 1e-6);
  let rgb = ryb_to_rgb(ryb) * shade;

  let document_offset = (frag.xy - vec2f(1.0, 1.0) / 2.0) * d.surface.z;
  let grain_alpha = ${prefix}_alpha_multiplier(document_offset, d.limits.zw);

  let alpha = clamp(coverage * grain_alpha * d.surface.w, 0.0, 1.0);
  return vec4f(rgb * alpha, alpha);
}
`.trim();
}
