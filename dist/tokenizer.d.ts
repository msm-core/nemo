/**
 * tokenizer.ts — nemo token types + CST adapter.
 *
 * Wraps @msm-core/cst and maps its 5 types (ROOT|ROLE|REL|STR|LIT)
 * to nemo's 18-type vocabulary (CONCEPT|ROLE|REL|LIT|NEG|MODAL|…|WHICH_Q).
 */
export type TokenType = "CONCEPT" | "ROLE" | "REL" | "LIT" | "NEG" | "QUERY" | "COND" | "CAUSE" | "FUTURE" | "PAST" | "MODAL" | "WHAT_Q" | "WHICH_Q" | "WHERE_Q" | "WHEN_Q" | "WHO_Q" | "WHY_Q" | "HOW_Q";
/** Nemo's enriched token — maps to one of the 18 TokenType values. */
export interface NemoToken {
    type: TokenType;
    value: string;
    surface: string;
    field?: string;
    role?: string;
}
/** @deprecated Use NemoToken. Kept for backward compatibility. */
export type CSTToken = NemoToken;
export declare function tokenize(sentence: string): NemoToken[];
export declare function tokenizeAr(sentence: string): NemoToken[];
export declare function tokenStream(sentence: string): string;
export declare function tokenStreamAr(sentence: string): string;
/** Arabic compound phrases map — re-exported for backward compat with tests. */
export declare const COMPOUND_FIELDS_AR: Record<string, string>;
//# sourceMappingURL=tokenizer.d.ts.map