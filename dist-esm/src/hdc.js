/**
 * hdc.ts — MAP HDC primitives in pure TypeScript.
 *
 * Bipolar {-1, +1} vectors stored as Float32Array.
 * No dependencies, works in Node.js and browser.
 *
 *   bind(a, b)    = a * b   — elementwise multiply, self-inverse
 *   bundle(vs)    = sign(sum(vs)) — majority vote prototype
 *   similarity    = cosine ∈ [-1, 1]
 */
export const DIM = 10_000;
/** Seeded pseudo-random using xorshift32 (deterministic, portable). */
function xorshift32(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s >>> 0) / 0x100000000;
    };
}
/** Generate a random bipolar {-1, +1} hypervector. */
export function randomHV(dim = DIM, rng) {
    const r = rng ?? xorshift32(Math.floor(Math.random() * 0x7fffffff));
    const hv = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
        hv[i] = r() < 0.5 ? -1 : 1;
    }
    return hv;
}
/** Create a seeded RNG. Seed must be the same as used during training. */
export function makeRNG(seed) {
    return xorshift32(seed);
}
/** Elementwise multiply — self-inverse: bind(bind(a,b),b) == a */
export function bind(a, b) {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++)
        out[i] = a[i] * b[i];
    return out;
}
/** Majority-vote bundle of multiple HVs into a prototype. */
export function bundle(vectors) {
    if (vectors.length === 0)
        throw new Error("bundle: empty array");
    const dim = vectors[0].length;
    const sum = new Float32Array(dim);
    for (const hv of vectors) {
        for (let i = 0; i < dim; i++)
            sum[i] += hv[i];
    }
    const out = new Float32Array(dim);
    for (let i = 0; i < dim; i++)
        out[i] = sum[i] >= 0 ? 1 : -1;
    return out;
}
/** Cosine similarity → float in [-1, 1]. */
export function similarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}
/** Return entries of memory sorted by descending similarity to query. */
export function nearest(query, memory) {
    const scores = [];
    for (const [key, hv] of memory) {
        scores.push([key, similarity(query, hv)]);
    }
    return scores.sort((a, b) => b[1] - a[1]);
}
