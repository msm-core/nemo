/**
 * tokenizer.ts — nemo token types + CST adapter.
 *
 * Wraps @msm-core/cst and maps its 5 types (ROOT|ROLE|REL|STR|LIT)
 * to nemo's 18-type vocabulary (CONCEPT|ROLE|REL|LIT|NEG|MODAL|…|WHICH_Q).
 */

import {
  tokenizeEn,
  tokenizeAr as cstTokenizeAr,
  getArCompounds,
} from "@msm-core/cst";
import type { CSTToken as CstToken } from "@msm-core/cst";

// ── Nemo token types (superset of CST's 5) ────────────────────────────────────

export type TokenType =
  | "CONCEPT"
  | "ROLE"
  | "REL"
  | "LIT"
  | "NEG"
  | "QUERY"
  | "COND"
  | "CAUSE"
  | "FUTURE"
  | "PAST"
  | "MODAL"
  | "WHAT_Q"
  | "WHICH_Q"
  | "WHERE_Q"
  | "WHEN_Q"
  | "WHO_Q"
  | "WHY_Q"
  | "HOW_Q";

/** Nemo's enriched token — maps to one of the 18 TokenType values. */
export interface NemoToken {
  type: TokenType;
  value: string; // compact form: "CONCEPT:write", "ROLE:agent", "NEG", …
  surface: string; // original word from input
  field?: string; // semantic field (CONCEPT tokens only)
  role?: string; // morphological role (ROLE tokens only)
}

/** @deprecated Use NemoToken. Kept for backward compatibility. */
export type CSTToken = NemoToken;

// ── STR.structure → nemo type ─────────────────────────────────────────────────

const STR_TO_TYPE: Record<string, TokenType> = {
  negation: "NEG",
  modal: "MODAL",
  future: "FUTURE",
  past: "PAST",
  conditional: "COND",
  cause: "CAUSE",
  question: "QUERY",
  what_question: "WHAT_Q",
  who_question: "WHO_Q",
  where_question: "WHERE_Q",
  when_question: "WHEN_Q",
  why_question: "WHY_Q",
  how_question: "HOW_Q",
  which_question: "WHICH_Q",
};

// CST emits structure="question" for ALL wh-words; resolve the specific type
// from the surface word so nemo gets WHERE_Q / WHO_Q / etc. not just QUERY.
const WH_SURFACE_TYPE: Record<string, TokenType> = {
  // English
  where: "WHERE_Q",
  wherever: "WHERE_Q",
  who: "WHO_Q",
  whom: "WHO_Q",
  whose: "WHO_Q",
  what: "WHAT_Q",
  when: "WHEN_Q",
  why: "WHY_Q",
  how: "HOW_Q",
  which: "WHICH_Q",
  // Arabic
  أين: "WHERE_Q",
  من: "WHO_Q",
  ماذا: "WHAT_Q",
  ما: "WHAT_Q",
  متى: "WHEN_Q",
  لماذا: "WHY_Q",
  لمَ: "WHY_Q",
  كيف: "HOW_Q",
  أي: "WHICH_Q",
  أية: "WHICH_Q",
};

// ── Token conversion ──────────────────────────────────────────────────────────

function convertToken(t: CstToken): NemoToken[] {
  // CST emits ROOT + ROLE as separate tokens (the "Arabic algebra" design).
  // Nemo maps ROOT → CONCEPT (its own HDC field atom) and
  // ROLE → ROLE (paired with preceding CONCEPT in the encoder).
  if (t.type === "ROOT") {
    return [
      {
        type: "CONCEPT",
        value: `CONCEPT:${t.field}`,
        surface: t.surface,
        field: t.field,
      },
    ];
  }
  if (t.type === "ROLE") {
    return [
      {
        type: "ROLE",
        value: `ROLE:${t.role}`,
        surface: t.surface,
        role: t.role,
      },
    ];
  }
  if (t.type === "STR" && t.structure) {
    // For generic "question" tokens, resolve specific WH-type from surface word.
    const nemoType =
      t.structure === "question"
        ? (WH_SURFACE_TYPE[t.surface] ??
          WH_SURFACE_TYPE[t.surface.toLowerCase()] ??
          STR_TO_TYPE[t.structure])
        : STR_TO_TYPE[t.structure];
    return nemoType
      ? [{ type: nemoType, value: nemoType, surface: t.surface }]
      : [];
  }
  if (t.type === "REL" && t.relation)
    return [{ type: "REL", value: `REL:${t.relation}`, surface: t.surface }];
  return [{ type: "LIT", value: `LIT:${t.surface}`, surface: t.surface }];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function tokenize(sentence: string): NemoToken[] {
  return tokenizeEn(sentence).tokens.flatMap(convertToken);
}

export function tokenizeAr(sentence: string): NemoToken[] {
  return cstTokenizeAr(sentence).tokens.flatMap(convertToken);
}

export function tokenStream(sentence: string): string {
  return tokenize(sentence)
    .map((t) => t.value)
    .join(" ");
}

export function tokenStreamAr(sentence: string): string {
  return tokenizeAr(sentence)
    .map((t) => t.value)
    .join(" ");
}

/** Arabic compound phrases map — re-exported for backward compat with tests. */
export const COMPOUND_FIELDS_AR: Record<string, string> = getArCompounds();
