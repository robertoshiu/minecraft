// Deterministic, seedable Perlin (gradient) noise for world generation.
//
// Algorithm: classic Ken Perlin gradient noise with a quintic fade curve.
// - A 256-entry permutation table is built deterministically from the seed
//   using a mulberry32 PRNG and a Fisher-Yates shuffle, then doubled to avoid
//   index wrapping in the lattice lookups.
// - 2D and 3D gradients are picked from fixed unit-ish gradient sets, so the
//   raw output is mathematically bounded and the function is C^2-continuous
//   (smooth) thanks to the quintic fade.
//
// No third-party deps, no Math.random, no Date: identical output for a given
// seed across runs and machines.

export type NoiseFn2D = (x: number, z: number) => number;
export type NoiseFn3D = (x: number, y: number, z: number) => number;

// --- 32-bit PRNG / hash helpers -------------------------------------------

/** mulberry32: tiny, fast, deterministic 32-bit PRNG. Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic integer hash of (seed, x, y) -> [0, 1).
 * Useful as a standalone value hash; not used by the gradient lattice.
 */
export function hash2(seed: number, x: number, y: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d) >>> 0;
  h = Math.imul(h ^ (y | 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// --- Permutation table ------------------------------------------------------

const TABLE_SIZE = 256;
const TABLE_MASK = TABLE_SIZE - 1;

/** Build a seed-dependent doubled permutation table (length 512). */
function buildPermutation(seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const p = new Uint8Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i++) p[i] = i;

  // Fisher-Yates shuffle driven by the seeded PRNG.
  for (let i = TABLE_SIZE - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i] ?? 0;
    p[i] = p[j] ?? 0;
    p[j] = tmp;
  }

  // Double the table so lattice lookups never need a modulo.
  const perm = new Uint8Array(TABLE_SIZE * 2);
  for (let i = 0; i < TABLE_SIZE * 2; i++) {
    perm[i] = p[i & TABLE_MASK] ?? 0;
  }
  return perm;
}

// --- Math helpers -----------------------------------------------------------

/** Quintic fade 6t^5 - 15t^4 + 10t^3 (C^2 continuous). */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

// 2D gradient directions: 8 evenly spaced unit vectors. Dot with a vector
// inside the unit cell stays bounded; max raw |noise| < 1.
const GRAD2: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

function grad2(hashValue: number, x: number, y: number): number {
  const g = GRAD2[hashValue & 7] ?? GRAD2[0];
  // g is always defined (mask keeps index in [0,7]); fallback satisfies types.
  const gx = g?.[0] ?? 0;
  const gy = g?.[1] ?? 0;
  return gx * x + gy * y;
}

// 3D gradients: the classic 12 edge-midpoint directions of a cube (Perlin's
// "improved noise" set), indexed via hash & 15 mapped into 12 vectors.
function grad3(hashValue: number, x: number, y: number, z: number): number {
  const h = hashValue & 15;
  const u = h < 8 ? x : y;
  let v: number;
  if (h < 4) v = y;
  else if (h === 12 || h === 14) v = x;
  else v = z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

// --- Public factories -------------------------------------------------------

/**
 * Create a deterministic 2D Perlin noise function for the given seed.
 * Output is smooth and bounded roughly within [-1, 1].
 */
export function makeNoise2D(seed: number): NoiseFn2D {
  const perm = buildPermutation(seed >>> 0);

  return (x: number, z: number): number => {
    const xi = Math.floor(x) & TABLE_MASK;
    const zi = Math.floor(z) & TABLE_MASK;
    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);

    const u = fade(xf);
    const w = fade(zf);

    const aa = perm[(perm[xi] ?? 0) + zi] ?? 0;
    const ab = perm[(perm[xi] ?? 0) + zi + 1] ?? 0;
    const ba = perm[(perm[xi + 1] ?? 0) + zi] ?? 0;
    const bb = perm[(perm[xi + 1] ?? 0) + zi + 1] ?? 0;

    const x1 = lerp(grad2(aa, xf, zf), grad2(ba, xf - 1, zf), u);
    const x2 = lerp(grad2(ab, xf, zf - 1), grad2(bb, xf - 1, zf - 1), u);

    // Raw range is about [-0.707, 0.707]; scale toward [-1, 1].
    return lerp(x1, x2, w) * 1.4142135623730951;
  };
}

/**
 * Create a deterministic 3D Perlin noise function for the given seed.
 * Output is smooth and bounded roughly within [-1, 1].
 */
export function makeNoise3D(seed: number): NoiseFn3D {
  const perm = buildPermutation(seed >>> 0);

  return (x: number, y: number, z: number): number => {
    const xi = Math.floor(x) & TABLE_MASK;
    const yi = Math.floor(y) & TABLE_MASK;
    const zi = Math.floor(z) & TABLE_MASK;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);

    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const a = (perm[xi] ?? 0) + yi;
    const aa = (perm[a] ?? 0) + zi;
    const ab = (perm[a + 1] ?? 0) + zi;
    const b = (perm[xi + 1] ?? 0) + yi;
    const ba = (perm[b] ?? 0) + zi;
    const bb = (perm[b + 1] ?? 0) + zi;

    const x1 = lerp(
      grad3(perm[aa] ?? 0, xf, yf, zf),
      grad3(perm[ba] ?? 0, xf - 1, yf, zf),
      u,
    );
    const x2 = lerp(
      grad3(perm[ab] ?? 0, xf, yf - 1, zf),
      grad3(perm[bb] ?? 0, xf - 1, yf - 1, zf),
      u,
    );
    const y1 = lerp(x1, x2, v);

    const x3 = lerp(
      grad3(perm[aa + 1] ?? 0, xf, yf, zf - 1),
      grad3(perm[ba + 1] ?? 0, xf - 1, yf, zf - 1),
      u,
    );
    const x4 = lerp(
      grad3(perm[ab + 1] ?? 0, xf, yf - 1, zf - 1),
      grad3(perm[bb + 1] ?? 0, xf - 1, yf - 1, zf - 1),
      u,
    );
    const y2 = lerp(x3, x4, v);

    // 3D improved-noise raw range is within [-1, 1]; pass through.
    return lerp(y1, y2, w);
  };
}

// --- Fractal Brownian motion ------------------------------------------------

/**
 * Fractal Brownian motion over a 2D noise function. Sums `octaves` layers of
 * noise at increasing frequency (lacunarity) and decreasing amplitude (gain),
 * then normalizes by the total amplitude so the result stays in ~[-1, 1].
 */
export function fbm2d(
  noise: NoiseFn2D,
  x: number,
  z: number,
  octaves: number,
  lacunarity: number = 2,
  gain: number = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let totalAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, z * frequency) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  if (totalAmplitude === 0) return 0;
  return sum / totalAmplitude;
}

/**
 * Fractal Brownian motion over a 3D noise function. See {@link fbm2d}.
 */
export function fbm3d(
  noise: NoiseFn3D,
  x: number,
  y: number,
  z: number,
  octaves: number,
  lacunarity: number = 2,
  gain: number = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let totalAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, y * frequency, z * frequency) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  if (totalAmplitude === 0) return 0;
  return sum / totalAmplitude;
}
