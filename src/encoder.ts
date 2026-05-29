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
import { randomHV, makeRNG, bind, bundle, similarity, DIM } from "./hdc";

const SEED = 42;

const FIELDS = [
  "know", "think", "speak", "write", "see", "feel",
  "make", "create", "destroy", "fix", "work",
  "move", "send", "give", "gather", "hold", "connect",
  "exist", "want",
  "govern", "fight", "trade", "social", "possess",
  "science", "health", "tech", "art", "sport",
  "nature", "weather", "animal", "plant", "body", "food",
  "material", "color",
  "time", "place", "size", "measure", "quality",
];

const ROLES = [
  "agent", "patient", "instance", "state", "place", "possible",
  "negate", "repeat", "before", "wrong", "mutual", "exceed",
  "has", "manner", "quality", "past", "plural", "process",
];

const STR_OPERATORS = new Set(["STR:negation", "STR:question", "STR:condition"]);
const STR_MODIFIERS = new Set(["STR:past", "STR:future"]);

const STR_TYPE_MAP: Record<string, string> = {
  NEG:    "STR:negation",
  QUERY:  "STR:question",
  PAST:   "STR:past",
  FUTURE: "STR:future",
  COND:   "STR:condition",
  CAUSE:  "REL:causes",
};

const FIELD_SET = new Set(FIELDS);

export type AtomState = Record<string, number[]>;

export class HDVEncoder {
  readonly dim: number;
  private _rng: () => number;
  private _atoms: Map<string, Float32Array> = new Map();

  constructor(dim: number = DIM, seed: number = SEED) {
    this.dim = dim;
    this._rng = makeRNG(seed);
    // Pre-register all atoms in deterministic order
    for (const f of FIELDS)   this._atom(`CONCEPT:${f}`);
    for (const r of ROLES)    this._atom(`ROLE:${r}`);
    for (const s of [...STR_OPERATORS, ...STR_MODIFIERS]) this._atom(s);
  }

  private _atom(key: string): Float32Array {
    if (!this._atoms.has(key)) {
      this._atoms.set(key, randomHV(this.dim, this._rng));
    }
    return this._atoms.get(key)!;
  }

  /**
   * Encode a CSTToken list into a single hypervector.
   * Returns [hv, dominantField | null].
   */
  encode(tokens: CSTToken[]): [Float32Array, string | null] {
    const content:  Float32Array[] = [];
    const strOps:   Float32Array[] = [];
    const strMods:  Float32Array[] = [];
    const fieldCnt: Map<string, number> = new Map();

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      const ttype = tok.type;

      // Structural operators/modifiers
      if (STR_TYPE_MAP[ttype]) {
        const atomKey = STR_TYPE_MAP[ttype];
        const hv = this._atom(atomKey);
        if (STR_OPERATORS.has(atomKey))      strOps.push(hv);
        else if (STR_MODIFIERS.has(atomKey)) strMods.push(hv);
        else                                 content.push(hv);
        i++; continue;
      }

      // CONCEPT — may be paired with following ROLE
      if (ttype === "CONCEPT" && tok.field && FIELD_SET.has(tok.field)) {
        fieldCnt.set(tok.field, (fieldCnt.get(tok.field) ?? 0) + 1);
        const cHV = this._atom(`CONCEPT:${tok.field}`);
        if (i + 1 < tokens.length && tokens[i + 1].type === "ROLE" && tokens[i + 1].role) {
          const rHV = this._atom(`ROLE:${tokens[i + 1].role}`);
          content.push(bind(cHV, rHV), cHV, rHV);
          i += 2; continue;
        }
        content.push(cHV);
        i++; continue;
      }

      // Lone ROLE
      if (ttype === "ROLE" && tok.role) {
        content.push(this._atom(`ROLE:${tok.role}`));
        i++; continue;
      }

      // REL — dynamic atom
      if (ttype === "REL") {
        content.push(this._atom(tok.value));
        i++; continue;
      }

      i++; // LIT, wh-tokens → skip
    }

    if (content.length === 0) {
      return [randomHV(this.dim, this._rng), null];
    }

    let hv = bundle(content);
    if (strMods.length > 0) hv = bundle([hv, ...strMods]);
    for (let j = strOps.length - 1; j >= 0; j--) {
      hv = bind(strOps[j], hv);
    }

    let dominant: string | null = null;
    let maxCount = 0;
    for (const [f, c] of fieldCnt) {
      if (c > maxCount) { maxCount = c; dominant = f; }
    }

    return [hv, dominant];
  }

  /** Export all atom HVs as plain arrays (JSON-serialisable). */
  atomState(): AtomState {
    const out: AtomState = {};
    for (const [k, hv] of this._atoms) {
      out[k] = Array.from(hv);
    }
    return out;
  }

  /** Restore atom HVs from a previously exported state. */
  loadAtomState(state: AtomState): void {
    this._atoms.clear();
    for (const [k, arr] of Object.entries(state)) {
      this._atoms.set(k, new Float32Array(arr));
    }
  }
}
