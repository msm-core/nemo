/**
 * tokenizer.ts — nemo token types + CST adapter.
 *
 * Imports @msm-ai/cst as the tokenizer backend and maps its 4 structural
 * types to nemo's 18-type vocabulary.
 */

import {
  tokenizeEn,
  tokenizeAr as cstTokenizeAr,
  getArCompounds,
} from "@msm-ai/cst";
import type { CSTToken as CstToken } from "@msm-ai/cst";

// ── Nemo token types (superset of CST's 4) ────────────────────────────────────

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

export interface CSTToken {
  type: TokenType;
  value: string; // compact form: "CONCEPT:write", "ROLE:agent", "NEG", …
  surface: string; // original word from input
  field?: string; // semantic field (CONCEPT tokens only)
  role?: string; // morphological role (ROLE tokens only)
}

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

// ── Token conversion ──────────────────────────────────────────────────────────

function convertToken(t: CstToken): CSTToken[] {
  if (t.type === "CONCEPT") {
    const out: CSTToken[] = [
      {
        type: "CONCEPT",
        value: `CONCEPT:${t.field}`,
        surface: t.surface,
        field: t.field,
      },
    ];
    if (t.role)
      out.push({
        type: "ROLE",
        value: `ROLE:${t.role}`,
        surface: t.surface,
        role: t.role,
      });
    return out;
  }
  if (t.type === "STR" && t.structure) {
    const nemoType = STR_TO_TYPE[t.structure];
    return nemoType
      ? [{ type: nemoType, value: nemoType, surface: t.surface }]
      : [];
  }
  if (t.type === "REL" && t.relation)
    return [{ type: "REL", value: `REL:${t.relation}`, surface: t.surface }];
  return [{ type: "LIT", value: `LIT:${t.surface}`, surface: t.surface }];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function tokenize(sentence: string): CSTToken[] {
  return tokenizeEn(sentence).tokens.flatMap(convertToken);
}

export function tokenizeAr(sentence: string): CSTToken[] {
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
