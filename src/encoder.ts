/**
 * encoder.ts — HDVEncoder: NemoToken list → bipolar hypervector.
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

import { NemoToken } from "./tokenizer";
import { randomHV, makeRNG, bind, bundle, similarity, DIM } from "./hdc";

const SEED = 42;

const FIELDS = [
  "know",
  "think",
  "speak",
  "write",
  "see",
  "feel",
  "make",
  "create",
  "destroy",
  "fix",
  "work",
  "move",
  "send",
  "give",
  "gather",
  "hold",
  "connect",
  "exist",
  "want",
  "govern",
  "fight",
  "trade",
  "social",
  "possess",
  "science",
  "health",
  "tech",
  "art",
  "sport",
  "nature",
  "weather",
  "animal",
  "plant",
  "body",
  "food",
  "material",
  "color",
  "time",
  "place",
  "size",
  "measure",
  "quality",
];

const ROLES = [
  "agent",
  "patient",
  "instance",
  "state",
  "place",
  "possible",
  "negate",
  "repeat",
  "before",
  "wrong",
  "mutual",
  "exceed",
  "has",
  "manner",
  "quality",
  "past",
  "plural",
  "process",
];

const STR_OPERATORS = new Set([
  "STR:negation",
  "STR:question",
  "STR:condition",
]);
const STR_MODIFIERS = new Set(["STR:past", "STR:future"]);

const STR_TYPE_MAP: Record<string, string> = {
  NEG: "STR:negation",
  QUERY: "STR:question",
  PAST: "STR:past",
  FUTURE: "STR:future",
  COND: "STR:condition",
  CAUSE: "REL:causes",
};

const FIELD_SET = new Set(FIELDS);

/**
 * Sub-field pairs derived from CST FIELDS_L2.
 * Format: [parentField, qualifier]
 * HDC encoding: bind(atom(CONCEPT:parent), atom(QUAL:qualifier))
 * This gives the child HV ~50% cosine similarity to its parent,
 * while all siblings cluster around the same parent.
 */
const SUB_FIELDS: Array<[string, string]> = [
  // tech
  ["tech", "code"],
  ["tech", "ai"],
  ["tech", "hardware"],
  ["tech", "network"],
  ["tech", "iot"],
  ["tech", "security"],
  // health
  ["health", "symptom"],
  ["health", "drug"],
  ["health", "treatment"],
  ["health", "fitness"],
  // social
  ["social", "family"],
  ["social", "org"],
  ["social", "contact"],
  ["social", "community"],
  // time
  ["time", "alarm"],
  ["time", "calendar"],
  ["time", "duration"],
  // trade
  ["trade", "price"],
  ["trade", "order"],
  ["trade", "stock"],
  ["trade", "currency"],
  // know
  ["know", "search"],
  ["know", "read"],
  ["know", "news"],
  ["know", "question"],
  // speak
  ["speak", "command"],
  ["speak", "greeting"],
  ["speak", "farewell"],
  // move
  ["move", "drive"],
  ["move", "fly"],
  ["move", "walk"],
  ["move", "ride"],
  // place
  ["place", "city"],
  ["place", "country"],
  ["place", "home"],
  ["place", "route"],
  // weather
  ["weather", "rain"],
  ["weather", "temp"],
  ["weather", "forecast"],
  // art
  ["art", "music"],
  ["art", "film"],
  ["art", "visual"],
  ["art", "book"],
  // food
  ["food", "recipe"],
  ["food", "restaurant"],
  ["food", "nutrition"],
];

/** Lookup: "parent.qualifier" → [parent, qualifier] */
const SUB_FIELD_MAP = new Map<string, [string, string]>(
  SUB_FIELDS.map(([p, q]) => [`${p}.${q}`, [p, q]]),
);

export type AtomState = Record<string, number[]>;

export class HDVEncoder {
  readonly dim: number;
  private _rng: () => number;
  private _atoms: Map<string, Float32Array> = new Map();

  constructor(dim: number = DIM, seed: number = SEED) {
    this.dim = dim;
    this._rng = makeRNG(seed);
    // Pre-register all atoms in deterministic order.
    // IMPORTANT: new atom groups must only be appended — never inserted —
    // to preserve the RNG sequence for existing atoms.
    for (const f of FIELDS) this._atom(`CONCEPT:${f}`);
    for (const r of ROLES) this._atom(`ROLE:${r}`);
    for (const s of [...STR_OPERATORS, ...STR_MODIFIERS]) this._atom(s);
    // QUAL atoms for sub-fields — registered after all existing atoms.
    // Unique qualifiers only, in SUB_FIELDS declaration order.
    const _seenQuals = new Set<string>();
    for (const [, qual] of SUB_FIELDS) {
      if (!_seenQuals.has(qual)) {
        this._atom(`QUAL:${qual}`);
        _seenQuals.add(qual);
      }
    }
  }

  private _atom(key: string): Float32Array {
    if (!this._atoms.has(key)) {
      this._atoms.set(key, randomHV(this.dim, this._rng));
    }
    return this._atoms.get(key)!;
  }

  /**
   * Encode a NemoToken list into a single hypervector.
   * Returns [hv, dominantField | null].
   */
  encode(tokens: NemoToken[]): [Float32Array, string | null] {
    const content: Float32Array[] = [];
    const strOps: Float32Array[] = [];
    const strMods: Float32Array[] = [];
    const fieldCnt: Map<string, number> = new Map();

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      const ttype = tok.type;

      // Structural operators/modifiers
      if (STR_TYPE_MAP[ttype]) {
        const atomKey = STR_TYPE_MAP[ttype];
        const hv = this._atom(atomKey);
        if (STR_OPERATORS.has(atomKey)) strOps.push(hv);
        else if (STR_MODIFIERS.has(atomKey)) strMods.push(hv);
        else content.push(hv);
        i++;
        continue;
      }

      // CONCEPT — may be paired with following ROLE.
      // Handles both L1 fields ("social") and L2 dot-fields ("social.community").
      // L2 encoding: bind(CONCEPT:parent, QUAL:qualifier) — gives the child HV
      // ~50% cosine similarity to its parent while siblings remain distinct.
      // fieldCnt always tracks the L1 parent so dominant() returns a stable L1 label.
      if (ttype === "CONCEPT" && tok.field) {
        const sub = SUB_FIELD_MAP.get(tok.field);
        let cHV: Float32Array;
        let l1field: string;
        if (sub) {
          const [parent, qual] = sub;
          const parentHV = this._atom(`CONCEPT:${parent}`);
          // Bundling parentHV with the bind product ensures the child HV retains
          // ~50% cosine similarity to its L1 parent for hierarchical retrieval.
          cHV = bundle([bind(parentHV, this._atom(`QUAL:${qual}`)), parentHV]);
          l1field = parent;
        } else if (FIELD_SET.has(tok.field)) {
          cHV = this._atom(`CONCEPT:${tok.field}`);
          l1field = tok.field;
        } else {
          i++; // unknown field → skip
          continue;
        }
        fieldCnt.set(l1field, (fieldCnt.get(l1field) ?? 0) + 1);
        if (
          i + 1 < tokens.length &&
          tokens[i + 1].type === "ROLE" &&
          tokens[i + 1].role
        ) {
          const rHV = this._atom(`ROLE:${tokens[i + 1].role}`);
          content.push(bind(cHV, rHV), cHV, rHV);
          i += 2;
          continue;
        }
        content.push(cHV);
        i++;
        continue;
      }

      // Lone ROLE
      if (ttype === "ROLE" && tok.role) {
        content.push(this._atom(`ROLE:${tok.role}`));
        i++;
        continue;
      }

      // REL — dynamic atom
      if (ttype === "REL") {
        content.push(this._atom(tok.value));
        i++;
        continue;
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
      if (c > maxCount) {
        maxCount = c;
        dominant = f;
      }
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
