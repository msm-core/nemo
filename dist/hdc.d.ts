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
export declare const DIM = 10000;
/** Generate a random bipolar {-1, +1} hypervector. */
export declare function randomHV(dim?: number, rng?: () => number): Float32Array;
/** Create a seeded RNG. Seed must be the same as used during training. */
export declare function makeRNG(seed: number): () => number;
/** Elementwise multiply — self-inverse: bind(bind(a,b),b) == a */
export declare function bind(a: Float32Array, b: Float32Array): Float32Array;
/** Majority-vote bundle of multiple HVs into a prototype. */
export declare function bundle(vectors: Float32Array[]): Float32Array;
/** Cosine similarity → float in [-1, 1]. */
export declare function similarity(a: Float32Array, b: Float32Array): number;
/** Return entries of memory sorted by descending similarity to query. */
export declare function nearest(query: Float32Array, memory: Map<string, Float32Array>): Array<[string, number]>;
//# sourceMappingURL=hdc.d.ts.map