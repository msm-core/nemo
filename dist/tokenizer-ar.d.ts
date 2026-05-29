/**
 * tokenizer-ar.ts — Arabic CST Tokenizer.
 *
 * Produces the same CSTToken[] interface as the English tokenizer so the
 * HDC encoder and agent work unchanged for Arabic input.
 *
 * Pipeline:
 *   1. Normalize   — strip diacritics, unify hamza/alef forms, remove tatweel
 *   2. Segment     — split attached clitics (و/ف/ب/ل/ال prefix, ها/هم/ك suffix)
 *   3. Root lookup — pattern/table lookup → canonical root string (e.g. "ktb")
 *   4. Field map   — root → semantic field (same field names as English)
 *   5. Structural  — structural words → direct TokenType mapping
 *   6. Fallback    — unknown → LIT (falls through to LLM)
 *
 * Arabic and English atoms share the same semantic field names ("write", "know",
 * etc.) so prototypes learned from English transfer to Arabic and vice-versa —
 * one HDCAgent handles both languages in the same vector space.
 */
import { CSTToken } from "./tokenizer";
export declare const COMPOUND_FIELDS_AR: Record<string, string>;
/**
 * Tokenize Arabic text into CSTToken[].
 * Same output interface as the English tokenizer → same encoder + agent.
 *
 * All 18 TokenTypes are possible:
 *   CONCEPT — from root/direct-field lookup OR compound bigram (COMPOUND_FIELDS_AR)
 *   ROLE    — from detectRoleAr() (agent, patient, process, place) — emitted
 *             even without a CONCEPT (parity with English tokenizer)
 *   REL     — from RELATION_MAP_AR
 *   LIT     — unknown words (→ full_llm fallback)
 *   NEG / QUERY / COND / CAUSE / FUTURE / PAST / MODAL — from STRUCTURAL_MAP_AR
 *   WHAT_Q / WHICH_Q / WHERE_Q / WHEN_Q / WHO_Q / WHY_Q / HOW_Q — from STRUCTURAL_MAP_AR
 */
export declare function tokenizeAr(sentence: string): CSTToken[];
/** Human-readable token stream for Arabic input. */
export declare function tokenStreamAr(sentence: string): string;
//# sourceMappingURL=tokenizer-ar.d.ts.map