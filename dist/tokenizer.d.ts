/**
 * tokenizer.ts — CST (Cognitive Semantic Tokenizer) for English.
 *
 * Converts raw English text → CSTToken list.
 * Self-contained: no dependencies.
 *
 * Token types:
 *   Core:       CONCEPT | ROLE | REL | LIT
 *   Structural: NEG | QUERY | COND | CAUSE | FUTURE | PAST | MODAL
 *   Question:   WHAT_Q | WHICH_Q | WHERE_Q | WHEN_Q | WHO_Q | WHY_Q | HOW_Q
 */
export type TokenType = "CONCEPT" | "ROLE" | "REL" | "LIT" | "NEG" | "QUERY" | "COND" | "CAUSE" | "FUTURE" | "PAST" | "MODAL" | "WHAT_Q" | "WHICH_Q" | "WHERE_Q" | "WHEN_Q" | "WHO_Q" | "WHY_Q" | "HOW_Q";
export interface CSTToken {
    type: TokenType;
    value: string;
    surface: string;
    field?: string;
    role?: string;
}
export declare const SEMANTIC_FIELDS: Record<string, string>;
export declare const COMPOUND_FIELDS: Record<string, string>;
/** Convert an English sentence into CST reasoning-mode tokens. */
export declare function tokenize(sentence: string): CSTToken[];
/** Human-readable token stream string. */
export declare function tokenStream(sentence: string): string;
//# sourceMappingURL=tokenizer.d.ts.map