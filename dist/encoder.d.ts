/**
 * encoder.ts — HDVEncoder: CSTToken list → bipolar hypervector.
 *
 * Same algebra as the Python package:
 *   CONCEPT + ROLE pair → bind(concept_hv, role_hv) ⊕ concept_hv ⊕ role_hv
 *   NEG / QUERY         → operator (bound to result)
 *   PAST / FUTURE       → modifier (bundled)
 *   REL                 → bundled into content
 *   LIT / wh-tokens     → skipped
 *
 * Atom HVs are generated from a seeded xorshift32 RNG. Same seed → same
 * atom space → prototypes are reusable across restarts.
 */
import { CSTToken } from "./tokenizer";
export type AtomState = Record<string, number[]>;
export declare class HDVEncoder {
    readonly dim: number;
    private _rng;
    private _atoms;
    constructor(dim?: number, seed?: number);
    private _atom;
    /**
     * Encode a CSTToken list into a single hypervector.
     * Returns [hv, dominantField | null].
     */
    encode(tokens: CSTToken[]): [Float32Array, string | null];
    /** Export all atom HVs as plain arrays (JSON-serialisable). */
    atomState(): AtomState;
    /** Restore atom HVs from a previously exported state. */
    loadAtomState(state: AtomState): void;
}
//# sourceMappingURL=encoder.d.ts.map