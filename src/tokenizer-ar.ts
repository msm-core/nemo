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

import { CSTToken, TokenType } from "./tokenizer";

// ── 1. Normalisation ──────────────────────────────────────────────────────────

const DIACRITIC_RE = /[\u064B-\u065F\u0670]/g;
const TATWEEL_RE   = /\u0640/g;
// Map variant forms of hamza/alef to canonical single character
const ALEF_VARIANTS: Record<string, string> = {
  "\u0622": "\u0627", // آ → ا
  "\u0623": "\u0627", // أ → ا
  "\u0625": "\u0627", // إ → ا
  "\u0671": "\u0627", // ٱ → ا
};
const YEH_VARIANTS: Record<string, string> = {
  "\u0649": "\u064A", // ى → ي
};
const WAW_VARIANTS: Record<string, string> = {
  "\u0624": "\u0648", // ؤ → و
};
const TA_MARBUTA = "\u0629"; // ة
const HA         = "\u0647"; // ه
function normalize(text: string): string {
  let s = text.replace(DIACRITIC_RE, "").replace(TATWEEL_RE, "");
  s = s.replace(/./g, (c) => ALEF_VARIANTS[c] ?? YEH_VARIANTS[c] ?? WAW_VARIANTS[c] ?? c);
  return s;
}
// ── 2. Clitic segmentation ───────────────────────────────────────────────────
// Order matters: longer prefixes first
const CONJUNCTIVE_PREFIXES = ["\u0648", "\u0641"]; // و ف  (and, so)
const PREP_PREFIXES        = ["\u0628", "\u0644", "\u0643"]; // ب ل ك (by/with, for/to, like)
const DEF_ARTICLE          = "\u0627\u0644"; // ال
const OBJECT_SUFFIXES = [
  "\u0647\u0645",   // هم  them (masc)
  "\u0647\u0646",   // هن  them (fem)
  "\u0643\u0645",   // كم  you (pl)
  "\u0647\u0627",   // ها  her/it
  "\u0647",         // ه   him/it
  "\u0643",         // ك   you (sg)
  "\u0646\u0627",   // نا  us
  "\u064A",         // ي   my (first-person possessive)
];

// Form-derived prefixes that signal augmented verb stems.
// Stripping these exposes the base stem for ROOT_MAP lookup.
// Order: longest first to avoid partial matches.
const VERB_AUG_PREFIXES = [
  "\u0627\u0633\u062A", // است  Form X (istaf'ala)
  "\u062A",             // ت    Form V (tafa''ala) — also Form VI, X etc.
  "\u0627",             // ا    Form I 1st-person (أ normalized → ا) OR Form VIII after infix
];

/** Strip leading clitics + definite article, trailing object suffixes. Returns stem. */
function segment(word: string): string {
  let s = word;
  // Conjunctive prefix (و / ف)
  for (const p of CONJUNCTIVE_PREFIXES) {
    if (s.startsWith(p) && s.length > p.length + 2) { s = s.slice(p.length); break; }
  }
  // Preposition prefix (ب / ل / ك)
  for (const p of PREP_PREFIXES) {
    if (s.startsWith(p) && s.length > p.length + 2) { s = s.slice(p.length); break; }
  }
  // Definite article ال
  if (s.startsWith(DEF_ARTICLE) && s.length > DEF_ARTICLE.length + 1) {
    s = s.slice(DEF_ARTICLE.length);
  }
  // Object/possessive suffixes (remove one)
  for (const suf of OBJECT_SUFFIXES) {
    if (s.endsWith(suf) && s.length > suf.length + 2) { s = s.slice(0, -suf.length); break; }
  }
  // Normalize tā-marbūṭah to hā (ة→ه) on stem end for root matching
  if (s.endsWith(TA_MARBUTA)) s = s.slice(0, -1) + HA;
  // Strip trailing accusative alef (ـاً → ـا after diacritic removal) when length > 3
  // Handles indefinite accusative nouns: موعداً → موعدا → موعد
  if (s.endsWith("\u0627") && s.length > 3) s = s.slice(0, -1);
  return s;
}

/**
 * Try augmented-verb prefix stripping as a fallback when the direct stem
 * is not in ROOT_MAP / DIRECT_FIELD.
 * Form X  استـ  → strip 3 chars  (استكتب → كتب)
 * Form V   تـ   → strip 1 char   (تتبع → تبع — then lookup يتبع via ROOT_MAP)
 * 1st-pers ا    → strip 1 char   (اريد → ريد → lookup يريد)
 * Returns the shortened stem, or the original if no rule fires.
 */
function stripVerbAug(stem: string): string {
  // Form X: است prefix (min remaining length 3)
  if (stem.startsWith(VERB_AUG_PREFIXES[0]) && stem.length > 5) {
    return stem.slice(3);
  }
  // Form V/VI: ت prefix — only strip when length ≥ 5 (تتبع=4 not useful, تسجيل=5 ok)
  if (stem.startsWith(VERB_AUG_PREFIXES[1]) && stem.length >= 5) {
    return stem.slice(1);
  }
  // 1st-person ا prefix — only strip when remaining ≥ 3 chars
  if (stem.startsWith(VERB_AUG_PREFIXES[2]) && stem.length >= 4) {
    return stem.slice(1);
  }
  return stem;
}
// ── 3. Root table — Arabic stems (post-normalize + post-segment) → root code ──
// 700+ entries across all 40 CST semantic fields.
// Uses real Arabic characters (UTF-8) for maintainability.
const ROOT_MAP: Record<string, string> = {
  // ── Write / Document — ktb ───────────────────────────────────────────────
  "كتب":    "ktb",  "يكتب":   "ktb",  "كتابه":  "ktb",
  "كتاب":   "ktb",  "كاتب":   "ktb",  "مكتوب":  "ktb",
  "مكتبه":  "ktb",  "كتيب":   "ktb",  "كتابات": "ktb",
  // Document / Record — sjl
  "سجل":    "sjl",  "يسجل":   "sjl",  "تسجيل":  "sjl",
  "مسجل":   "sjl",  "سجلات":  "sjl",
  // Print / Publish — ṭbʿ
  "طبع":    "ṭbʿ",  "يطبع":   "ṭbʿ",  "طباعه":  "ṭbʿ",
  "طابع":   "ṭbʿ",  "مطبوع":  "ṭbʿ",  "مطبعه":  "ṭbʿ",
  // Compose / Draft — ʾnšʾ
  "انشا":   "ʾnšʾ", "انشاء":  "ʾnšʾ", "ينشئ":   "ʾnšʾ",
  // ── Know / Learn — ʿlm ───────────────────────────────────────────────────
  "علم":    "ʿlm",  "يعلم":   "ʿlm",  "علوم":   "ʿlm",
  "عالم":   "ʿlm",  "معلوم":  "ʿlm",  "تعلم":   "ʿlm",
  "معلم":   "ʿlm",  "تعليم":  "ʿlm",  "علمي":   "ʿlm",
  "تعليمي": "ʿlm",  "معلومه": "ʿlm",  "معلومات":"ʿlm",
  // Know / Recognize — ʿrf
  "عرف":    "ʿrf",  "يعرف":   "ʿrf",  "معرفه":  "ʿrf",
  "معروف":  "ʿrf",  "عارف":   "ʿrf",
  // Read — qrʾ
  "قرا":    "qrʾ",  "يقرا":   "qrʾ",  "قراءه":  "qrʾ",
  "قارئ":   "qrʾ",  "مقروء":  "qrʾ",  "قراءات": "qrʾ",
  // Understand — fhm
  "فهم":    "fhm",  "يفهم":   "fhm",  "مفهوم":  "fhm",
  "تفاهم":  "fhm",  "فاهم":   "fhm",
  // Study / Research — drss
  "درس":    "drss", "يدرس":   "drss", "دراسه":  "drss",
  "دراسات": "drss", "مدرسه":  "drss", "مدرس":   "drss",
  // Research — bḥṯ
  "بحث":    "bḥṯ",  "يبحث":   "bḥṯ",  "بحوث":   "bḥṯ",
  "باحث":   "bḥṯ",  "مبحث":   "bḥṯ",
  // Discover — kšf
  "كشف":    "kšf",  "يكشف":   "kšf",  "اكتشف":  "kšf",
  "اكتشاف": "kšf",  "كاشف":   "kšf",
  // Educate — tʿlm
  "يتعلم":  "tʿlm",
  "متعلم":  "tʿlm",
  // ── Speak / Communicate — qwl ─────────────────────────────────────────────
  "قال":    "qwl",  "يقول":   "qwl",  "قول":    "qwl",
  "مقال":   "qwl",  "اقوال":  "qwl",  "مقولات": "qwl",
  // Talk — tkl
  "تكلم":   "tkl",  "يتكلم":  "tkl",  "متكلم":  "tkl",
  "كلام":   "tkl",  "كلمه":   "tkl",  "كلمات":  "tkl",
  // Discuss — ḥdṯ
  "حدث":    "ḥdṯ",  "يحدث":   "ḥdṯ",  "حديث":   "ḥdṯ",
  "محادثه": "ḥdṯ",  "محدث":   "ḥdṯ",  "احاديث": "ḥdṯ",
  // Explain — šrḥ
  "شرح":    "šrḥ",  "يشرح":   "šrḥ",  "شارح":   "šrḥ",
  "شروح":   "šrḥ",  "مشروح":  "šrḥ",  "تشريح":  "šrḥ",
  // Announce — ʾʿln
  "اعلن":   "ʾʿln", "يعلن":   "ʾʿln", "اعلان":  "ʾʿln",
  "معلن":   "ʾʿln", "اعلانات":"ʾʿln",
  // Ask / Inquire — sʾl
  "سال":    "sʾl",  "يسال":   "sʾl",  "سؤال":   "sʾl",
  "اسئله":  "sʾl",  "مسؤول":  "sʾl",
  // Lecture / Speech — ḵṭb
  "خطب":    "ḵṭb",  "خطاب":   "ḵṭb",  "خطيب":   "ḵṭb",
  "خطبه":   "ḵṭb",  "مخطوب":  "ḵṭb",
  // Reply / Answer — jb
  "اجاب":   "jb",   "يجيب":   "jb",   "اجابه":  "jb",
  "مجيب":   "jb",   "جواب":   "jb",   "اجوبه":  "jb",
  // ── Send / Transmit — rsl ─────────────────────────────────────────────────
  "ارسل":   "rsl",  "يرسل":   "rsl",  "رساله":  "rsl",
  "مرسل":   "rsl",  "ارسال":  "rsl",  "رسائل":  "rsl",
  // Deliver — wṣl
  "وصل":    "wṣl",  "يوصل":   "wṣl",  "توصيل":  "wṣl",
  "واصل":   "wṣl",  "موصول":  "wṣl",
  // Broadcast — bṯṯ
  "يبث":    "bṯṯ",  "بث":     "bṯṯ",
  "مذيع":   "bṯṯ",
  // ── Move / Travel — ḥrk ───────────────────────────────────────────────────
  "حرك":    "ḥrk",  "يتحرك":  "ḥrk",  "حركه":   "ḥrk",
  "متحرك":  "ḥrk",  "حراك":   "ḥrk",
  // Go — ḏhb
  "ذهب":    "ḏhb",  "يذهب":   "ḏhb",  "ذهاب":   "ḏhb",
  "ذاهب":   "ḏhb",
  // Come — jʾ
  "جاء":    "jʾ",   "يجيء":   "jʾ",   "مجيء":   "jʾ",
  // Walk — mšy
  "مشى":    "mšy",  "يمشي":   "mšy",  "مشي":    "mšy",
  "ماشي":   "mšy",  "مشاه":   "mšy",
  // Travel — sfr
  "سافر":   "sfr",  "يسافر":  "sfr",  "سفر":    "sfr",
  "مسافر":  "sfr",  "سفرات":  "sfr",  "اسفار":  "sfr",
  // Arrive — wṣl (arrive sense)
  "يصل":    "wṣl",  "وصول":   "wṣl",
  // Run — rḍ
  "يركض":   "rḍ",   "ركض":    "rḍ",
  // Carry / Transport — ḥml
  "يحمل":   "ḥml",  "حمل":    "ḥml",
  "حامل":   "ḥml",  "محمول":  "ḥml",  "حمولات": "ḥml",
  // Move house / Migrate — ntql
  "انتقل":  "ntql", "ينتقل":  "ntql", "انتقال": "ntql",
  "هاجر":   "hjr",  "يهاجر":  "hjr",  "هجره":   "hjr",
  "مهاجر":  "hjr",
  // ── Create / Make — ṣnʿ ───────────────────────────────────────────────────
  "صنع":    "ṣnʿ",  "يصنع":   "ṣnʿ",  "صناعه":  "ṣnʿ",
  "صانع":   "ṣnʿ",  "مصنوع":  "ṣnʿ",  "مصنع":   "ṣnʿ",
  "صناعي":  "ṣnʿ",
  // Build — bny
  "بنى":    "bny",  "يبني":   "bny",  "بناء":   "bny",
  "مبني":   "bny",  "بنايه":  "bny",  "مباني":  "bny",
  // Create / Generate — ḵlq
  "يخلق":   "ḵlq",  "خلق":    "ḵlq",
  "خالق":   "ḵlq",  "مخلوق":  "ḵlq",  "خليقه":  "ḵlq",
  // Invent — ḵtrʿ
  "اخترع":  "ḵtrʿ", "يخترع":  "ḵtrʿ", "اختراع": "ḵtrʿ",
  "مخترع":  "ḵtrʿ",
  // Design — ṣmm
  "صمم":    "ṣmm",  "يصمم":   "ṣmm",  "تصميم":  "ṣmm",
  "مصمم":   "ṣmm",  "تصاميم": "ṣmm",
  // Produce — ntj
  "انتج":   "ntj",  "ينتج":   "ntj",  "انتاج":  "ntj",
  "منتج":   "ntj",  "منتجات": "ntj",  "انتاجي": "ntj",
  // Develop / Improve — ṭwr
  "طور":    "ṭwr",  "يطور":   "ṭwr",  "تطوير":  "ṭwr",
  "مطور":   "ṭwr",  "تطور":   "ṭwr",
  // ── Work / Operate — ʿml ─────────────────────────────────────────────────
  "يعمل":   "ʿml",  "عمل":    "ʿml",
  "عامل":   "ʿml",  "عمال":   "ʿml",  "معمل":   "ʿml",
  "عملي":   "ʿml",  "اعمال":  "ʿml",
  // Job / Employ — šġl
  "يشغل":   "šġl",  "شغل":    "šġl",
  "شاغل":   "šġl",  "وظيفه":  "šġl",  "وظائف":  "šġl",
  // Manage — ʾdr
  "ادار":   "ʾdr",  "يدير":   "ʾdr",  "اداره":  "ʾdr",
  "مدير":   "ʾdr",  "ادارات": "ʾdr",  "اداري":  "ʾdr",
  // Lead — qwd
  "قاد":    "qwd",  "يقود":   "qwd",  "قياده":  "qwd",
  "قائد":   "qwd",  "قادة":   "qwd",
  // ── Give / Present — ʿṭy ─────────────────────────────────────────────────
  "اعطى":   "ʿṭy",  "يعطي":   "ʿṭy",  "عطاء":   "ʿṭy",
  "معطي":   "ʿṭy",
  // Present / Offer — qddm
  "قدم":    "qddm", "يقدم":   "qddm", "تقديم":  "qddm",
  "مقدم":   "qddm", "مقدمه":  "qddm",
  // Grant / Donate — mnḥ
  "منح":    "mnḥ",  "يمنح":   "mnḥ",  "منحه":   "mnḥ",
  "ممنوح":  "mnḥ",
  // Gift — hdy
  "اهدى":   "hdy",  "يهدي":   "hdy",  "هديه":   "hdy",
  "هدايا":  "hdy",
  // Donate — tbrrʿ
  "يتبرع":  "tbrrʿ","تبرع":   "tbrrʿ",
  "متبرع":  "tbrrʿ","تبرعات": "tbrrʿ",
  // Share — šrk
  "شارك":   "šrk",  "يشارك":  "šrk",  "مشاركه": "šrk",
  "مشارك":  "šrk",
  // ── Hold / Keep / Store — ḥfẓ ─────────────────────────────────────────────
  "حفظ":    "ḥfẓ",  "يحفظ":   "ḥfẓ",  "محفوظ":  "ḥfẓ",
  "حافظ":   "ḥfẓ",  "حفاظ":   "ḥfẓ",
  // Keep / Maintain — ʾmsk
  "امسك":   "mssk", "يمسك":   "mssk", "مسك":    "mssk",
  "ماسك":   "mssk",
  // Store — ḵzn
  "يخزن":   "ḵzn",  "خزن":    "ḵzn",
  "خازن":   "ḵzn",  "مخزن":   "ḵzn",  "مخزون":  "ḵzn",
  // Take / Receive — ʾḵḏ
  "ياخذ":   "ʾḵḏ",  "اخذ":    "ʾḵḏ",
  "اخيذ":   "ʾḵḏ",
  // Preserve — ḥmy
  "حمى":    "ḥmy",  "يحمي":   "ḥmy",  "حمايه":  "ḥmy",
  "حامي":   "ḥmy",  "محمي":   "ḥmy",
  // ── Think / Reason — fkr ─────────────────────────────────────────────────
  "فكر":    "fkr",  "يفكر":   "fkr",  "فكره":   "fkr",
  "تفكير":  "fkr",  "مفكر":   "fkr",  "افكار":  "fkr",
  // Plan — ḵṭṭ
  "خطط":    "ḵṭṭ",  "يخطط":   "ḵṭṭ",  "خطه":    "ḵṭṭ",
  "تخطيط":  "ḵṭṭ",  "مخطط":   "ḵṭṭ",
  // Believe — ʿtqd
  "اعتقد":  "ʿtqd", "يعتقد":  "ʿtqd", "اعتقاد": "ʿtqd",
  "معتقد":  "ʿtqd",
  // Analyze — ḥll
  "حلل":    "ḥll",  "يحلل":   "ḥll",  "تحليل":  "ḥll",
  "محلل":   "ḥll",  "تحليلي": "ḥll",
  // Reason / Logic — mnṭq
  "منطق":   "mnṭq", "منطقي":  "mnṭq", "استنتج": "mnṭq",
  "استنتاج":"mnṭq",
  // Wonder / Imagine — tṣwr
  "يتصور":  "tṣwr", "تصور":   "tṣwr",
  "متصور":  "tṣwr",
  // ── See / Observe — rʾy ───────────────────────────────────────────────────
  "راى":    "rʾy",  "يرى":    "rʾy",  "رؤيه":   "rʾy",
  "مرئي":   "rʾy",  "رائي":   "rʾy",
  // Look / Watch — nẓr
  "نظر":    "nẓr",  "ينظر":   "nẓr",  "نظرات":  "nẓr",
  "ناظر":   "nẓr",  "منظور":  "nẓr",  "منظر":   "nẓr",
  // Watch / Observe — šhd
  "شاهد":   "šhd",  "يشاهد":  "šhd",  "مشاهده": "šhd",
  "مشاهد":  "šhd",  "شهيد":   "šhd",
  // Notice — lḥẓ
  "لاحظ":   "lḥẓ",  "يلاحظ":  "lḥẓ",  "ملاحظه": "lḥẓ",
  "ملاحظات":"lḥẓ",
  // Search / Find — bḥṯ
  // ── Feel / Sense — šʿr ───────────────────────────────────────────────────
  "شعر":    "šʿr",  "يشعر":   "šʿr",  "شعور":   "šʿr",
  "مشاعر":  "šʿr",
  // Sense — ḥss
  "احس":    "ḥss",  "يحس":    "ḥss",  "احساس":  "ḥss",
  // Love — ḥbb
  "احب":    "ḥbb",  "يحب":    "ḥbb",  "حب":     "ḥbb",
  "محبوب":  "ḥbb",  "حبيب":   "ḥbb",  "محبه":   "ḥbb",
  // Fear — ḵwf
  "خاف":    "ḵwf",  "يخاف":   "ḵwf",  "خوف":    "ḵwf",
  "خائف":   "ḵwf",  "مخيف":   "ḵwf",
  // Hope — aml
  "يامل":   "aml",  "امل":    "aml",
  "اماني":  "aml",
  // Want / Desire — ʾrd
  "اراد":   "ʾrd",  "يريد":   "ʾrd",  "اراده":  "ʾrd",
  // Desire — rġb
  "رغب":    "rġb",  "يرغب":   "rġb",  "رغبه":   "rġb",
  "راغب":   "rġb",  "رغبات":  "rġb",
  // Wish — tmny
  "تمنى":   "tmny", "يتمنى":  "tmny", "تمني":   "tmny",
  "امنيه":  "tmny",
  // Hate — krh
  "يكره":   "krh",  "كره":    "krh",
  "كاره":   "krh",  "مكروه":  "krh",
  // ── Exist / Be — kwn / wjd ────────────────────────────────────────────────
  "كان":    "kwn",  "يكون":   "kwn",  "كائن":   "kwn",
  "وجد":    "wjd",  "يوجد":   "wjd",  "وجود":   "wjd",
  "موجود":  "wjd",
  // Live — ʿyš
  "عاش":    "ʿyš",  "يعيش":   "ʿyš",  "حياه":   "ʿyš",
  "حي":     "ʿyš",  "احياء":  "ʿyš",
  // Appear / Emerge — ẓhr
  "ظهر":    "ẓhr",  "يظهر":   "ẓhr",  "ظهور":   "ẓhr",
  "ظاهر":   "ẓhr",  "ظاهره":  "ẓhr",
  // Become — ṣbḥ
  "اصبح":   "ṣbḥ",  "يصبح":   "ṣbḥ",  "صبح":    "ṣbḥ",
  // ── Govern / Lead — ḥkm ───────────────────────────────────────────────────
  "يحكم":   "ḥkm",  "حكم":    "ḥkm",
  "حاكم":   "ḥkm",  "حكومه":  "ḥkm",  "محكوم":  "ḥkm",
  "حكام":   "ḥkm",  "احكام":  "ḥkm",
  // Rule / Control — slṭ
  "سيطر":   "slṭ",  "يسيطر":  "slṭ",  "سيطره":  "slṭ",
  "سلطه":   "slṭ",  "سلطان":  "slṭ",  "مسيطر":  "slṭ",
  // Administer — ʾdr (same as manage above, kept for field)
  // Political — syst
  "سياسه":  "syst", "سياسي":  "syst", "سياسيون":"syst",
  "دوله":   "syst", "دول":    "syst",
  // Law / Regulate — qnn
  "قانون":  "qnn",  "قانوني": "qnn",  "تشريع":  "qnn",
  "مشرع":   "qnn",
  // ── Fight / Conflict — ḥrb ────────────────────────────────────────────────
  "حرب":    "ḥrb",  "يحارب":  "ḥrb",  "محاربه": "ḥrb",
  "حارب":   "ḥrb",  "حروب":   "ḥrb",
  // Kill / Battle — qtl
  "قاتل":   "qtl",  "يقاتل":  "qtl",  "قتال":   "qtl",
  "مقاتل":  "qtl",  "قتل":    "qtl",
  // Attack — hjm
  "هجم":    "hjm",  "يهجم":   "hjm",  "هجوم":   "hjm",
  "هاجم":   "hjm",  "مهاجم":  "hjm",
  // Defend — dfʿ
  "دافع":   "dfʿ",  "يدافع":  "dfʿ",  "دفاع":   "dfʿ",
  "مدافع":  "dfʿ",  "دفاعي":  "dfʿ",
  // Conflict / Struggle — nzʿ
  "نزع":    "nzʿ",  "نزاع":   "nzʿ",  "تنازع":  "nzʿ",
  "صراع":   "nzʿ",  "تعارض":  "nzʿ",
  // Destroy / Demolish — hdm
  "يهدم":   "hdm",  "هدم":    "hdm",
  "هادم":   "hdm",  "مهدوم":  "hdm",
  // ── Trade / Economy — tjr ─────────────────────────────────────────────────
  "تاجر":   "tjr",  "يتاجر":  "tjr",  "تجاره":  "tjr",
  "تجاري":  "tjr",  "تجار":   "tjr",
  // Buy — šry
  "اشترى":  "šry",  "يشتري":  "šry",  "شراء":   "šry",
  "مشتري":  "šry",
  // Sell — byʿ
  "باع":    "byʿ",  "يبيع":   "byʿ",  "بيع":    "byʿ",
  "بائع":   "byʿ",  "مباع":   "byʿ",
  // Economy — iqtṣd
  "اقتصاد": "iqtṣd","اقتصادي":"iqtṣd","اقتصد":  "iqtṣd",
  // Market — swq
  "سوق":    "swq",  "اسواق":  "swq",  "سوقي":   "swq",
  // Price — thmn
  "ثمن":    "thmn", "اثمان":  "thmn", "ثمين":   "thmn",
  "سعر":    "thmn", "اسعار":  "thmn",
  // Money / Finance — ml
  "مال":    "ml",   "اموال":  "ml",   "مالي":   "ml",
  "مالكه":  "ml",   "تمويل":  "ml",
  // Contract — ʿqd
  "عقد":    "ʿqd",  "يعقد":   "ʿqd",  "عقود":   "ʿqd",
  "معاقده": "ʿqd",
  // ── Food / Eat — ʾkl ──────────────────────────────────────────────────────
  "ياكل":   "ʾkl",  "اكل":    "ʾkl",
  "اكله":   "ʾkl",  "ماكول":  "ʾkl",  "ماكولات":"ʾkl",
  // Food — ṭʿm
  "طعام":   "ṭʿm",  "اطعمه":  "ṭʿm",  "طعمه":   "ṭʿm",
  // Cook — ṭbḵ
  "طبخ":    "ṭbḵ",  "يطبخ":   "ṭbḵ",  "طباخ":   "ṭbḵ",
  "مطبخ":   "ṭbḵ",  "مطبوخ":  "ṭbḵ",
  // Meal — wjbh
  "وجبه":   "wjbh", "وجبات":  "wjbh",
  // Drink — šrb
  "شرب":    "šrb",  "يشرب":   "šrb",  "شراب":   "šrb",
  "شارب":   "šrb",  "مشروب":  "šrb",
  // Nutrition — ġḏy
  "غذى":    "ġḏy",  "يغذي":   "ġḏy",  "غذاء":   "ġḏy",
  "تغذيه":  "ġḏy",  "مغذي":   "ġḏy",
  // ── Health / Medicine — ṭbb ───────────────────────────────────────────────
  "طب":     "ṭbb",  "طبي":    "ṭbb",  "طبيب":   "ṭbb",
  "اطباء":  "ṭbb",  "مستشفى": "ṭbb",  "عياده":  "ṭbb",
  // Heal / Cure — šfʾ
  "شفى":    "šfʾ",  "يشفي":   "šfʾ",  "شفاء":   "šfʾ",
  "شافي":   "šfʾ",  "مشفى":   "šfʾ",
  // Sick — mrḍ
  "مرض":    "mrḍ",  "مريض":   "mrḍ",  "مرضى":   "mrḍ",
  "امراض":  "mrḍ",
  // Treat / Therapy — ʿlj
  "علج":    "ʿlj",  "يعالج":  "ʿlj",  "علاج":   "ʿlj",
  "معالج":  "ʿlj",  "علاجي":  "ʿlj",
  // Medicine / Drug — dws
  "دواء":   "dws",  "ادويه":  "dws",  "صيدليه": "dws",
  "صيدلاني":"dws",
  // Health / Fitness — ṣḥḥ
  "صحه":    "ṣḥḥ",  "صحي":    "ṣḥḥ",  "صحيح":   "ṣḥḥ",
  "اصح":    "ṣḥḥ",
  // Surgery — jrḥ
  "جراح":   "jrḥ",  "جراحه":  "jrḥ",  "عمليه":  "jrḥ",
  "مستشفي": "jrḥ",
  // ── Fix / Repair — ṣlḥ ────────────────────────────────────────────────────
  "اصلح":   "ṣlḥ",  "يصلح":   "ṣlḥ",  "اصلاح":  "ṣlḥ",
  "صالح":   "ṣlḥ",  "مصلوح":  "ṣlḥ",  "اصلاحات":"ṣlḥ",
  // Repair — rkmm
  "رمم":    "rkmm", "يرمم":   "rkmm", "ترميم":  "rkmm",
  "مرمم":   "rkmm",
  // Update — ḥdṯ (update sense)
  "تحديث":  "ḥdṯu",
  // Correct — ṣḥḥ (different from health ṣḥḥ — same root, same field "fix")
  "صحح":    "ṣḥḥc", "يصحح":   "ṣḥḥc", "تصحيح":  "ṣḥḥc",
  // ── Connect / Link — rbt ──────────────────────────────────────────────────
  "ربط":    "rbt",  "يربط":   "rbt",  "رابط":   "rbt",
  "مربوط":  "rbt",  "روابط":  "rbt",
  // Connect (join) — wṣl
  "اتصل":   "ʾtṣl", "يتصل":   "ʾtṣl", "اتصال":  "ʾtṣl",
  "متصل":   "ʾtṣl", "اتصالات":"ʾtṣl",
  // Integrate — dmj
  "يدمج":   "dmj",  "دمج":    "dmj",
  "مدمج":   "dmj",  "اندماج": "dmj",
  // Network — šbk
  "شبكه":   "šbk",  "شبكات":  "šbk",  "شبكي":   "šbk",
  // ── Destroy / Break — dmr ─────────────────────────────────────────────────
  "دمر":    "dmr",  "يدمر":   "dmr",  "تدمير":  "dmr",
  "مدمر":   "dmr",  "مدمره":  "dmr",
  // Break — ksr
  "يكسر":   "ksr",  "كسر":    "ksr",
  "كاسر":   "ksr",  "مكسور":  "ksr",
  // Damage — tlf
  "اتلف":   "tlf",  "يتلف":   "tlf",  "تلف":    "tlf",
  "تالف":   "tlf",
  // Destroy — hdm (same as fight entry above; separate root code)
  // Eliminate — qḍy
  "قضى":    "qḍy",  "يقضي":   "qḍy",  "قضاء":   "qḍy",
  "القضاء": "qḍy",
  // Delete — ḥḏf
  "حذف":    "ḥḏf",  "يحذف":   "ḥḏf",  "محذوف":  "ḥḏf",
  // ── Possess / Own — mlk ───────────────────────────────────────────────────
  "ملك":    "mlk",  "يملك":   "mlk",  "ملكيه":  "mlk",
  "مالك":   "mlk",  "مملوك":  "mlk",  "ممتلكات":"mlk",
  // Obtain — ḥṣl
  "حصل":    "ḥṣl",  "يحصل":   "ḥṣl",  "حصول":   "ḥṣl",
  "حاصل":   "ḥṣl",
  // ── Gather / Assemble — jmʿ ───────────────────────────────────────────────
  "يجمع":   "jmʿ",  "جمع":    "jmʿ",
  "جامع":   "jmʿ",  "مجموع":  "jmʿ",  "اجتماع": "jmʿ",
  // Meet — ltqy
  "التقى":  "ltqy", "يلتقي":  "ltqy", "التقاء": "ltqy",
  "ملتقى":  "ltqy", "لقاء":   "ltqy",
  // Group / Crowd — ḥšd
  "يحشد":   "ḥšd",  "حشد":    "ḥšd",
  "حاشد":   "ḥšd",
  // ── Science / Research — ʿlm (science) ────────────────────────────────────
  "فيزياء": "fzyk", "فيزيائي":"fzyk",
  "كيمياء": "kmy",  "كيميائي":"kmy",  "كيميائيه":"kmy",
  "بيولوجي":"ʾḥyʾ",
  "رياضيات":"ryḍyt","رياضي":  "ryḍyt",
  "نظريه":  "nẓry", "نظريات": "nẓry",
  "تجربه":  "tjrb", "تجارب":  "tjrb", "تجريبي": "tjrb",
  "معادله": "ʿdl",  "معادلات":"ʿdl",
  "اكتشافات":"kšf",
  "مختبر":  "ḵbr",  "مختبرات":"ḵbr",
  "جيولوجيا":"jyl", "جيولوجي":"jyl",
  "فلك":    "flk",  "فلكي":   "flk",  "فلكيات": "flk",
  // ── Technology — tqn ──────────────────────────────────────────────────────
  "تقنيه":  "tqn",  "تقني":   "tqn",  "تكنولوجيا":"tqn",
  "برنامج": "brmj", "برامج":  "brmj", "مبرمج":  "brmj",
  "برمجه":  "brmj", "يبرمج":  "brmj",
  "حاسوب":  "ḥsb",  "كمبيوتر":"ḥsb",
  "انترنت": "šbk",  "ويب":    "šbk",
  "تطبيق":  "tṭbyq","تطبيقات":"tṭbyq",
  "خوارزميه":"ḵwrzm","خوارزميات":"ḵwrzm",
  "قاعدة":   "ʾdb",  "بيانات": "ʾdb",
  "تشفير":  "tšfyr","مشفر":   "tšfyr",
  "سيبراني":"sybr",
  "اتمته":  "ʾtmt", "تلقائي": "ʾtmt",
  "روبوت":  "rwbt", "ذاتي":   "rwbt",
  "سحابه":  "sḥbh", "خادم":   "sḥbh",
  // ── Art / Creative — rsmm ─────────────────────────────────────────────────
  "رسم":    "rsmm", "يرسم":   "rsmm", "رسام":   "rsmm",
  "رسمه":   "rsmm", "رسومات": "rsmm",
  // Music — mwsq
  "موسيقى": "mwsq", "موسيقي": "mwsq", "موسيقار":"mwsq",
  "اغنيه":  "mwsq", "اغاني":  "mwsq", "الحان":  "mwsq",
  // Poetry — šʿr (different from feel šʿr — both map to their field)
  "شاعر":   "šʿrp", "قصيده":  "šʿrp",
  "قصائد":  "šʿrp", "شعري":   "šʿrp",
  // Film / Cinema — flm
  "فيلم":   "flm",  "افلام":  "flm",  "سينما":  "flm",
  "مخرج":   "flm",  "ممثل":   "flm",
  // Theater — msrḥ
  "مسرح":   "msrḥ", "مسرحيه": "msrḥ", "مسرحي":  "msrḥ",
  // Sculpture / Design — nqš
  "نقش":    "nqš",  "نحت":    "nqš",  "نحات":   "nqš",
  "تماثيل": "nqš",  "تمثال":  "nqš",
  // Photography — tṣwr
  "تصوير":  "tṣwrp","مصور":   "tṣwrp","صوره":   "tṣwrp",
  "صور":    "tṣwrp",
  // ── Sport / Athletics — ryḍ ───────────────────────────────────────────────
  "رياضه":  "ryḍ",  "رياضيون":"ryḍ",
  // Ball games — kry
  "كرات":   "kry",
  // Competition — sbq
  "سباق":   "sbq",  "تسابق":  "sbq",  "متسابق": "sbq",
  "مسابقه": "sbq",
  // Champion — bṭl
  "بطل":    "bṭl",  "بطوله":  "bṭl",  "ابطال":  "bṭl",
  "بطولات": "bṭl",
  // Play — lʿb
  "لعب":    "lʿb",  "يلعب":   "lʿb",  "لاعب":   "lʿb",
  "لعبه":   "lʿb",  "ملعب":   "lʿb",
  // Train — tdrb
  "تدرب":   "tdrb", "يتدرب":  "tdrb", "تدريب":  "tdrb",
  "مدرب":   "tdrb",
  // ── Nature / Environment — ṭbyʿ ───────────────────────────────────────────
  "طبيعه":  "ṭbyʿ", "طبيعي":  "ṭbyʿ",
  // Environment — byʾ
  "بيئه":   "byʾ",  "بيئي":   "byʾ",  "محيط":   "byʾ",
  // Forest / Jungle
  "غابات":  "ġbh",  "غابه":   "ġbh",
  // Mountain — jbl
  "جبل":    "jbl",  "جبال":   "jbl",  "جبلي":   "jbl",
  // Sea / Ocean — bḥr
  "بحر":    "bḥr",  "بحار":   "bḥr",
  // River — nhr
  "نهر":    "nhr",  "انهار":  "nhr",
  // Desert — ṣḥrʾ
  "صحراء":  "ṣḥrʾ", "صحراوي": "ṣḥrʾ",
  // Climate — mnḵ
  "مناخ":   "mnḵ",  "مناخي":  "mnḵ",
  // Ecosystem — byʾ
  // ── Weather — ṭqs ─────────────────────────────────────────────────────────
  "طقس":    "ṭqs",
  // Rain — mṭr
  "مطر":    "mṭr",  "امطار":  "mṭr",  "ممطر":   "mṭr",
  "يمطر":   "mṭr",
  // Snow — ṯlj
  "ثلج":    "ṯlj",  "ثلوج":   "ṯlj",  "مثلج":   "ṯlj",
  // Wind — ryḥ
  "ريح":    "ryḥ",  "رياح":   "ryḥ",  "عاصفه":  "ryḥ",
  // Temperature — ḥrrh
  "حراره":  "ḥrrh", "برودة":  "ḥrrh",
  // Sunny — šms
  "شمس":    "šms",  "مشمس":   "šms",  "اشعه":   "šms",
  // Clouds — ġym
  "غيوم":   "ġym",  "سحاب":   "ġym",  "غائم":   "ġym",
  // ── Measure / Calculate — ḥsb ─────────────────────────────────────────────
  "حسب":    "ḥsb",  "يحسب":   "ḥsb",  "حساب":   "ḥsb",
  "محاسبه": "ḥsb",
  // Measure — qys
  "قاس":    "qys",  "يقيس":   "qys",  "قياس":   "qys",
  "مقياس":  "qys",
  // Count — ʿdd
  "عد":     "ʿdd",  "يعد":    "ʿdd",  "عدد":    "ʿdd",
  "عداد":   "ʿdd",  "احصاء":  "ʿdd",
  // Convert — ḥwl
  "حول":    "ḥwl",  "يحول":   "ḥwl",  "تحويل":  "ḥwl",
  // Weight — wzn
  "وزن":    "wzn",  "يزن":    "wzn",  "موزون":  "wzn",
  // Length / Distance — msft
  "مسافه":  "msft", "بعد":    "msft", "طول":    "msft",
  "عرض":    "msft",
  // ─── CST root import ─────────────────────────────────────────────────────────

  // take (extended)
  "أخذ": "axD",  "يأخذ": "axD",  "أخذة": "axD",
  "قبل": "qbl",  "يقبل": "qbl",  "قبلة": "qbl",
  "سرق": "srq",  "يسرق": "srq",  "سرقة": "srq",
  "نهب": "nhb",  "ينهب": "nhb",  "نهبة": "nhb",
  "خطف": "xgf",  "يخطف": "xgf",  "خطفة": "xgf",
  "سلب": "slb",  "يسلب": "slb",  "سلبة": "slb",
  // change (extended)
  "بدل": "bdl",  "يبدل": "bdl",  "بدلة": "bdl",
  "غير": "Gyr",  "يغير": "Gyr",  "غيرة": "Gyr",
  "نمو": "nmw",  "ينمو": "nmw",  "نموة": "nmw",
  "زيد": "zyd",  "يزيد": "zyd",  "زيدة": "zyd",
  // dwell → exist
  "سكن": "skn",  "يسكن": "skn",  "سكنة": "skn",
  "عمر": "emr",  "يعمر": "emr",  "عمرة": "emr",
  "نزل": "nzl",  "ينزل": "nzl",  "نزلة": "nzl",
  "أقم": "aqm",  "يأقم": "aqm",  "أقمة": "aqm",
  // want → feel
  "طلب": "glb",  "يطلب": "glb",  "طلبة": "glb",
  "تمن": "tmn",  "يتمن": "tmn",  "تمنة": "tmn",
  "شهو": "chw",  "يشهو": "chw",  "شهوة": "chw",
  "بغي": "bGy",  "يبغي": "bGy",  "بغية": "bGy",
  // need → feel
  "حوج": "Hwj",  "يحوج": "Hwj",  "حوجة": "Hwj",
  "لزم": "lzm",  "يلزم": "lzm",  "لزمة": "lzm",
  "ضرر": "prr",  "يضرر": "prr",  "ضررة": "prr",
  "وجب": "wjb",  "يوجب": "wjb",  "وجبة": "wjb",
  // decide → think
  "قرر": "qrr",  "يقرر": "qrr",  "قررة": "qrr",
  "فصل": "fSl",  "يفصل": "fSl",  "فصلة": "fSl",
  "عزم": "ezm",  "يعزم": "ezm",  "عزمة": "ezm",
  // rest → exist
  "راح": "raH",  "يراح": "raH",  "راحة": "raH",
  "نوم": "nwm",  "ينوم": "nwm",  "نومة": "nwm",
  "هدأ": "hda",  "يهدأ": "hda",  "هدأة": "hda",
  "توق": "twq",  "يتوق": "twq",  "توقة": "twq",
  // contain → hold
  "ضمن": "pmn",  "يضمن": "pmn",  "ضمنة": "pmn",
  "حوي": "Hwy",  "يحوي": "Hwy",  "حوية": "Hwy",
  "شمل": "cml",  "يشمل": "cml",  "شملة": "cml",
  "ملأ": "mla",  "يملأ": "mla",  "ملأة": "mla",
  "فرغ": "frG",  "يفرغ": "frG",  "فرغة": "frG",
  // hide → hold
  "خفي": "xfy",  "يخفي": "xfy",  "خفية": "xfy",
  "كتم": "ktm",  "يكتم": "ktm",  "كتمة": "ktm",
  "غيب": "Gyb",  "يغيب": "Gyb",  "غيبة": "Gyb",
  "حجب": "Hjb",  "يحجب": "Hjb",  "حجبة": "Hjb",
  "خبأ": "xba",  "يخبأ": "xba",  "خبأة": "xba",
  "بطن": "bgn",  "يبطن": "bgn",  "بطنة": "bgn",
  // open → fix
  "فتح": "ftH",  "يفتح": "ftH",  "فتحة": "ftH",
  "غلق": "Glq",  "يغلق": "Glq",  "غلقة": "Glq",
  "قفل": "qfl",  "يقفل": "qfl",  "قفلة": "qfl",
  "ستر": "str",  "يستر": "str",  "سترة": "str",
  // force → fight
  "قوي": "qwy",  "يقوي": "qwy",  "قوية": "qwy",
  "ضغط": "pGg",  "يضغط": "pGg",  "ضغطة": "pGg",
  "جبر": "jbr",  "يجبر": "jbr",  "جبرة": "jbr",
  "قهر": "qhr",  "يقهر": "qhr",  "قهرة": "qhr",
  "أرغ": "arG",  "يأرغ": "arG",  "أرغة": "arG",
  "شدد": "cdd",  "يشدد": "cdd",  "شددة": "cdd",
  // enable → work
  "عون": "ewn",  "يعون": "ewn",  "عونة": "ewn",
  "نصر": "nSr",  "ينصر": "nSr",  "نصرة": "nSr",
  "سعف": "sef",  "يسعف": "sef",  "سعفة": "sef",
  "غوث": "GwT",  "يغوث": "GwT",  "غوثة": "GwT",
  "أنق": "anq",  "يأنق": "anq",  "أنقة": "anq",
  "مكن": "mkn",  "يمكن": "mkn",  "مكنة": "mkn",
  "أذن": "aDn",  "يأذن": "aDn",  "أذنة": "aDn",
  "سمح": "smH",  "يسمح": "smH",  "سمحة": "smH",
  "قدر": "qdr",  "يقدر": "qdr",  "قدرة": "qdr",
  "يسر": "ysr",  "ييسر": "ysr",  "يسرة": "ysr",
  // person → social
  "بشر": "bcr",  "يبشر": "bcr",  "بشرة": "bcr",
  "إنس": "ins",  "يإنس": "ins",  "إنسة": "ins",
  "رجل": "rjl",  "يرجل": "rjl",  "رجلة": "rjl",
  "مرأ": "mra",  "يمرأ": "mra",  "مرأة": "mra",
  "طفل": "gfl",  "يطفل": "gfl",  "طفلة": "gfl",
  "شيخ": "cyx",  "يشيخ": "cyx",  "شيخة": "cyx",
  "شبب": "cbb",  "يشبب": "cbb",  "شببة": "cbb",
  "نسب": "nsb",  "ينسب": "nsb",  "نسبة": "nsb",
  // name → know
  "سمي": "smy",  "يسمي": "smy",  "سمية": "smy",
  "لقب": "lqb",  "يلقب": "lqb",  "لقبة": "lqb",
  "عنو": "enw",  "يعنو": "enw",  "عنوة": "enw",
  "وسم": "wsm",  "يوسم": "wsm",  "وسمة": "wsm",
  // structure → create
  "شكل": "ckl",  "يشكل": "ckl",  "شكلة": "ckl",
  "هيك": "hyk",  "يهيك": "hyk",  "هيكة": "hyk",
  "نظم": "nZm",  "ينظم": "nZm",  "نظمة": "nZm",
  "صفف": "Sff",  "يصفف": "Sff",  "صففة": "Sff",
  "رتب": "rtb",  "يرتب": "rtb",  "رتبة": "rtb",
  "طبق": "gbq",  "يطبق": "gbq",  "طبقة": "gbq",
  // write (extended)
  "دون": "dwn",  "يدون": "dwn",  "دونة": "dwn",
  "رقم": "rqm",  "يرقم": "rqm",  "رقمة": "rqm",
  "نسخ": "nsx",  "ينسخ": "nsx",  "نسخة": "nsx",
  "نشر": "ncr",  "ينشر": "ncr",  "نشرة": "ncr",
  "صدر": "Sdr",  "يصدر": "Sdr",  "صدرة": "Sdr",
  "وثق": "wTq",  "يوثق": "wTq",  "وثقة": "wTq",
  "صحف": "SHf",  "يصحف": "SHf",  "صحفة": "SHf",
  // know (extended)
  "ثقف": "Tqf",  "يثقف": "Tqf",  "ثقفة": "Tqf",
  "خبر": "xbr",  "يخبر": "xbr",  "خبرة": "xbr",
  "فقه": "fqh",  "يفقه": "fqh",  "فقهة": "fqh",
  "رشد": "rcd",  "يرشد": "rcd",  "رشدة": "rcd",
  "لقن": "lqn",  "يلقن": "lqn",  "لقنة": "lqn",
  "وعي": "wey",  "يوعي": "wey",  "وعية": "wey",
  // speak (extended)
  "كلم": "klm",  "يكلم": "klm",  "كلمة": "klm",
  "نطق": "ngq",  "ينطق": "ngq",  "نطقة": "ngq",
  "صرخ": "Srx",  "يصرخ": "Srx",  "صرخة": "Srx",
  "ندي": "ndy",  "يندي": "ndy",  "ندية": "ndy",
  "لغو": "lGw",  "يلغو": "lGw",  "لغوة": "lGw",
  "حكي": "Hky",  "يحكي": "Hky",  "حكية": "Hky",
  "علن": "eln",  "علنة": "eln",
  "ذكر": "Dkr",  "يذكر": "Dkr",  "ذكرة": "Dkr",
  "روي": "rwy",  "يروي": "rwy",  "روية": "rwy",
  "سأل": "sal",  "يسأل": "sal",  "سألة": "sal",
  "جوب": "jwb",  "يجوب": "jwb",  "جوبة": "jwb",
  "فسر": "fsr",  "يفسر": "fsr",  "فسرة": "fsr",
  "وصف": "wSf",  "يوصف": "wSf",  "وصفة": "wSf",
  "بين": "byn",  "يبين": "byn",  "بينة": "byn",
  // think (extended)
  "عقل": "eql",  "يعقل": "eql",  "عقلة": "eql",
  "رأي": "ray",  "يرأي": "ray",  "رأية": "ray",
  "ظنن": "Znn",  "يظنن": "Znn",  "ظننة": "Znn",
  "خمن": "xmn",  "يخمن": "xmn",  "خمنة": "xmn",
  "زعم": "zem",  "يزعم": "zem",  "زعمة": "zem",
  // see (extended)
  "بصر": "bSr",  "يبصر": "bSr",  "بصرة": "bSr",
  "لحظ": "lHZ",  "يلحظ": "lHZ",  "لحظة": "lHZ",
  "لمح": "lmH",  "يلمح": "lmH",  "لمحة": "lmH",
  "رقب": "rqb",  "يرقب": "rqb",  "رقبة": "rqb",
  "تبع": "tbe",  "يتبع": "tbe",  "تبعة": "tbe",
  "رصد": "rSd",  "يرصد": "rSd",  "رصدة": "rSd",
  // feel (extended)
  "حبب": "Hbb",  "يحبب": "Hbb",  "حببة": "Hbb",
  "حزن": "Hzn",  "يحزن": "Hzn",  "حزنة": "Hzn",
  "فرح": "frH",  "يفرح": "frH",  "فرحة": "frH",
  "غضب": "Gpb",  "يغضب": "Gpb",  "غضبة": "Gpb",
  "قلق": "qlq",  "يقلق": "qlq",  "قلقة": "qlq",
  "رضي": "rpy",  "يرضي": "rpy",  "رضية": "rpy",
  "أمل": "aml",  "يأمل": "aml",  "أملة": "aml",
  "ندم": "ndm",  "يندم": "ndm",  "ندمة": "ndm",
  "ألم": "alm",  "يألم": "alm",  "ألمة": "alm",
  "سعد": "sed",  "يسعد": "sed",  "سعدة": "sed",
  "حنن": "Hnn",  "يحنن": "Hnn",  "حننة": "Hnn",
  "عشق": "ecq",  "يعشق": "ecq",  "عشقة": "ecq",
  "حير": "Hyr",  "يحير": "Hyr",  "حيرة": "Hyr",
  "ذعر": "Der",  "يذعر": "Der",  "ذعرة": "Der",
  "فزع": "fze",  "يفزع": "fze",  "فزعة": "fze",
  // move (extended)
  "رجع": "rje",  "يرجع": "rje",  "رجعة": "rje",
  "سير": "syr",  "يسير": "syr",  "سيرة": "syr",
  "رحل": "rHl",  "يرحل": "rHl",  "رحلة": "rHl",
  "هجر": "hjr",  "يهجر": "hjr",  "هجرة": "hjr",
  "جري": "jry",  "يجري": "jry",  "جرية": "jry",
  "طير": "gyr",  "يطير": "gyr",  "طيرة": "gyr",
  "عبر": "ebr",  "يعبر": "ebr",  "عبرة": "ebr",
  "هبط": "hbg",  "يهبط": "hbg",  "هبطة": "hbg",
  "صعد": "Sed",  "يصعد": "Sed",  "صعدة": "Sed",
  "دخل": "dxl",  "يدخل": "dxl",  "دخلة": "dxl",
  "خرج": "xrj",  "يخرج": "xrj",  "خرجة": "xrj",
  "فرر": "frr",  "يفرر": "frr",  "فررة": "frr",
  "سبح": "sbH",  "يسبح": "sbH",  "سبحة": "sbH",
  "قفز": "qfz",  "يقفز": "qfz",  "قفزة": "qfz",
  "زحف": "zHf",  "يزحف": "zHf",  "زحفة": "zHf",
  "ركب": "rkb",  "يركب": "rkb",  "ركبة": "rkb",
  // give (extended)
  "عطي": "egy",  "عطية": "egy",
  "وهب": "whb",  "يوهب": "whb",  "وهبة": "whb",
  "تبر": "tbr",  "يتبر": "tbr",  "تبرة": "tbr",
  // make → create
  "بني": "bny",  "بنية": "bny",
  "شيد": "cyd",  "يشيد": "cyd",  "شيدة": "cyd",
  "أنش": "anc",  "يأنش": "anc",  "أنشة": "anc",
  // destroy (extended)
  "حطم": "Hgm",  "يحطم": "Hgm",  "حطمة": "Hgm",
  "محق": "mHq",  "يمحق": "mHq",  "محقة": "mHq",
  "فني": "fny",  "يفني": "fny",  "فنية": "fny",
  "حرق": "Hrq",  "يحرق": "Hrq",  "حرقة": "Hrq",
  "غرق": "Grq",  "يغرق": "Grq",  "غرقة": "Grq",
  "خرب": "xrb",  "يخرب": "xrb",  "خربة": "xrb",
  "عدم": "edm",  "يعدم": "edm",  "عدمة": "edm",
  // exist (extended)
  "كون": "kwn",  "كونة": "kwn",
  "حيو": "Hyw",  "يحيو": "Hyw",  "حيوة": "Hyw",
  "بقي": "bqy",  "يبقي": "bqy",  "بقية": "bqy",
  "عيش": "eyc",  "عيشة": "eyc",
  // time (extended)
  "وقت": "wqt",  "يوقت": "wqt",  "وقتة": "wqt",
  "زمن": "zmn",  "يزمن": "zmn",  "زمنة": "zmn",
  "ترخ": "trx",  "يترخ": "trx",  "ترخة": "trx",
  "بدء": "bdq",  "يبدء": "bdq",  "بدءة": "bdq",
  "نهي": "nhy",  "ينهي": "nhy",  "نهية": "nhy",
  "ختم": "xtm",  "يختم": "xtm",  "ختمة": "xtm",
  "مهل": "mhl",  "يمهل": "mhl",  "مهلة": "mhl",
  // place (extended)
  "موض": "mwp",  "يموض": "mwp",  "موضة": "mwp",
  "بلد": "bld",  "يبلد": "bld",  "بلدة": "bld",
  "مدن": "mdn",  "يمدن": "mdn",  "مدنة": "mdn",
  "قري": "qry",  "يقري": "qry",  "قرية": "qry",
  "منط": "mng",  "يمنط": "mng",  "منطة": "mng",
  "حدد": "Hdd",  "يحدد": "Hdd",  "حددة": "Hdd",
  "قطر": "qgr",  "يقطر": "qgr",  "قطرة": "qgr",
  "ولي": "wly",  "يولي": "wly",  "ولية": "wly",
  // possess (extended)
  "حوز": "Hwz",  "يحوز": "Hwz",  "حوزة": "Hwz",
  "كسب": "ksb",  "يكسب": "ksb",  "كسبة": "ksb",
  "فقد": "fqd",  "يفقد": "fqd",  "فقدة": "fqd",
  "حرم": "Hrm",  "يحرم": "Hrm",  "حرمة": "Hrm",
  // trade (extended)
  "شري": "cry",  "يشري": "cry",  "شرية": "cry",
  "تجر": "tjr",  "يتجر": "tjr",  "تجرة": "tjr",
  "ربح": "rbH",  "يربح": "rbH",  "ربحة": "rbH",
  "خسر": "xsr",  "يخسر": "xsr",  "خسرة": "xsr",
  "كلف": "klf",  "يكلف": "klf",  "كلفة": "klf",   // cost/expense — klf
  // fight (extended)
  "جهد": "jhd",  "يجهد": "jhd",  "جهدة": "jhd",
  "نضل": "npl",  "ينضل": "npl",  "نضلة": "npl",
  "دفع": "dfe",  "يدفع": "dfe",  "دفعة": "dfe",
  "قوم": "qwm",  "يقوم": "qwm",  "قومة": "qwm",
  "غزو": "Gzw",  "يغزو": "Gzw",  "غزوة": "Gzw",
  // govern (extended)
  "سيس": "sys",  "يسيس": "sys",  "سيسة": "sys",
  "أمر": "amr",  "يأمر": "amr",  "أمرة": "amr",
  "قود": "qwd",  "قودة": "qwd",
  "رئس": "rs",  "يرئس": "rs",  "رئسة": "rs",
  // create (extended)
  "بدع": "bde",  "يبدع": "bde",  "بدعة": "bde",
  "ولد": "wld",  "يولد": "wld",  "ولدة": "wld",
  "فطر": "fgr",  "يفطر": "fgr",  "فطرة": "fgr",
  // body (extended)
  "جسم": "jsm",  "يجسم": "jsm",  "جسمة": "jsm",
  "رأس": "ras",  "يرأس": "ras",  "رأسة": "ras",
  "يدي": "ydy",  "ييدي": "ydy",  "يدية": "ydy",
  "قلب": "qlb",  "يقلب": "qlb",  "قلبة": "qlb",
  "عين": "eyn",  "يعين": "eyn",  "عينة": "eyn",
  "سمع": "sme",  "يسمع": "sme",  "سمعة": "sme",
  "دمم": "dmm",  "يدمم": "dmm",  "دممة": "dmm",
  "عظم": "eZm",  "يعظم": "eZm",  "عظمة": "eZm",
  "لحم": "lHm",  "يلحم": "lHm",  "لحمة": "lHm",
  "جلد": "jld",  "يجلد": "jld",  "جلدة": "jld",
  // food (extended)
  "أكل": "akl",  "يأكل": "akl",  "أكلة": "akl",
  "طعم": "gem",  "يطعم": "gem",  "طعمة": "gem",
  "جوع": "jwe",  "يجوع": "jwe",  "جوعة": "jwe",
  "عطش": "egc",  "يعطش": "egc",  "عطشة": "egc",
  "ذوق": "Dwq",  "يذوق": "Dwq",  "ذوقة": "Dwq",
  "هضم": "hpm",  "يهضم": "hpm",  "هضمة": "hpm",
  "غذي": "GDy",  "غذية": "GDy",
  // nature (extended)
  "أرض": "arp",  "يأرض": "arp",  "أرضة": "arp",
  "برر": "brr",  "يبرر": "brr",  "بررة": "brr",
  "صحر": "SHr",  "يصحر": "SHr",  "صحرة": "SHr",
  "غاب": "Gab",  "يغاب": "Gab",  "غابة": "Gab",
  "واد": "wad",  "يواد": "wad",  "وادة": "wad",
  "سهل": "shl",  "يسهل": "shl",  "سهلة": "shl",
  // weather (extended)
  "حرر": "Hrr",  "يحرر": "Hrr",  "حررة": "Hrr",
  "برد": "brd",  "يبرد": "brd",  "بردة": "brd",
  "غيم": "Gym",  "يغيم": "Gym",  "غيمة": "Gym",
  "عصف": "eSf",  "يعصف": "eSf",  "عصفة": "eSf",
  "فيض": "fyp",  "يفيض": "fyp",  "فيضة": "fyp",
  "جفف": "jff",  "يجفف": "jff",  "جففة": "jff",
  // animal (extended)
  "سمك": "smk",  "يسمك": "smk",  "سمكة": "smk",
  "حشر": "Hcr",  "يحشر": "Hcr",  "حشرة": "Hcr",
  "ذئب": "Db",  "يذئب": "Db",  "ذئبة": "Db",
  "أسد": "asd",  "يأسد": "asd",  "أسدة": "asd",
  "فرس": "frs",  "يفرس": "frs",  "فرسة": "frs",
  "بقر": "bqr",  "يبقر": "bqr",  "بقرة": "bqr",
  "غنم": "Gnm",  "يغنم": "Gnm",  "غنمة": "Gnm",
  "جمل": "jml",  "يجمل": "jml",  "جملة": "jml",
  "كلب": "klb",  "يكلب": "klb",  "كلبة": "klb",
  // plant (extended)
  "زرع": "zre",  "يزرع": "zre",  "زرعة": "zre",
  "نبت": "nbt",  "ينبت": "nbt",  "نبتة": "nbt",
  "شجر": "cjr",  "يشجر": "cjr",  "شجرة": "cjr",
  "ثمر": "Tmr",  "يثمر": "Tmr",  "ثمرة": "Tmr",
  "زهر": "zhr",  "يزهر": "zhr",  "زهرة": "zhr",
  "حصد": "HSd",  "يحصد": "HSd",  "حصدة": "HSd",
  "غرس": "Grs",  "يغرس": "Grs",  "غرسة": "Grs",
  "روض": "rwp",  "يروض": "rwp",  "روضة": "rwp",
  // color (extended)
  "لون": "lwn",  "يلون": "lwn",  "لونة": "lwn",
  "بيض": "byp",  "يبيض": "byp",  "بيضة": "byp",
  "سود": "swd",  "يسود": "swd",  "سودة": "swd",
  "حمر": "Hmr",  "يحمر": "Hmr",  "حمرة": "Hmr",
  "خضر": "xpr",  "يخضر": "xpr",  "خضرة": "xpr",
  "زرق": "zrq",  "يزرق": "zrq",  "زرقة": "zrq",
  "صفر": "Sfr",  "يصفر": "Sfr",  "صفرة": "Sfr",
  // size (extended)
  "كبر": "kbr",  "يكبر": "kbr",  "كبرة": "kbr",
  "صغر": "SGr",  "يصغر": "SGr",  "صغرة": "SGr",
  "قصر": "qSr",  "يقصر": "qSr",  "قصرة": "qSr",
  "وسع": "wse",  "يوسع": "wse",  "وسعة": "wse",
  "ضيق": "pyq",  "يضيق": "pyq",  "ضيقة": "pyq",
  "عمق": "emq",  "يعمق": "emq",  "عمقة": "emq",
  "كثر": "kTr",  "يكثر": "kTr",  "كثرة": "kTr",
  "قلل": "qll",  "يقلل": "qll",  "قللة": "qll",
  // measure (extended)
  "قيس": "qys",  "قيسة": "qys",
  "مسح": "msH",  "يمسح": "msH",  "مسحة": "msH",
  "قرب": "qrb",  "يقرب": "qrb",  "قربة": "qrb",
  "نصف": "nSf",  "ينصف": "nSf",  "نصفة": "nSf",
  // connect (extended)
  "ضمم": "pmm",  "يضمم": "pmm",  "ضممة": "pmm",
  "شبك": "cbk",  "يشبك": "cbk",  "شبكة": "cbk",
  "علق": "elq",  "يعلق": "elq",  "علقة": "elq",
  "زوج": "zwj",  "يزوج": "zwj",  "زوجة": "zwj",
  // hold (extended)
  "قبض": "qbp",  "يقبض": "qbp",  "قبضة": "qbp",
  "رفع": "rfe",  "يرفع": "rfe",  "رفعة": "rfe",
  // gather (extended)
  "لمم": "lmm",  "يلمم": "lmm",  "لممة": "lmm",
  "جني": "jny",  "يجني": "jny",  "جنية": "jny",
  // send (extended)
  "رسل": "rsl",  "رسلة": "rsl",
  "بعث": "beT",  "يبعث": "beT",  "بعثة": "beT",
  "وجه": "wjh",  "يوجه": "wjh",  "وجهة": "wjh",
  "نقل": "nql",  "ينقل": "nql",  "نقلة": "nql",
  "بثث": "bTT",  "يبثث": "bTT",  "بثثة": "bTT",
  // social (extended)
  "شرك": "crk",  "يشرك": "crk",  "شركة": "crk",
  "جور": "jwr",  "يجور": "jwr",  "جورة": "jwr",
  "أهل": "ahl",  "يأهل": "ahl",  "أهلة": "ahl",
  "شعب": "ceb",  "يشعب": "ceb",  "شعبة": "ceb",
  "أمم": "amm",  "يأمم": "amm",  "أممة": "amm",
  "حزب": "Hzb",  "يحزب": "Hzb",  "حزبة": "Hzb",
  // art (extended)
  "فنن": "fnn",  "يفنن": "fnn",  "فننة": "fnn",
  "زخر": "zxr",  "يزخر": "zxr",  "زخرة": "zxr",
  "لحن": "lHn",  "يلحن": "lHn",  "لحنة": "lHn",
  "غني": "Gny",  "يغني": "Gny",  "غنية": "Gny",
  "عزف": "ezf",  "يعزف": "ezf",  "عزفة": "ezf",
  "رقص": "rqS",  "يرقص": "rqS",  "رقصة": "rqS",
  "مثل": "mTl",  "يمثل": "mTl",  "مثلة": "mTl",
  // science (extended)
  "فحص": "fHS",  "يفحص": "fHS",  "فحصة": "fHS",
  "ركز": "rkz",  "يركز": "rkz",  "ركزة": "rkz",
  "مرس": "mrs",  "يمرس": "mrs",  "مرسة": "mrs",
  // sport (extended)
  "ريض": "ryp",  "يريض": "ryp",  "ريضة": "ryp",
  "سبق": "sbq",  "يسبق": "sbq",  "سبقة": "sbq",
  "فوز": "fwz",  "يفوز": "fwz",  "فوزة": "fwz",
  "هزم": "hzm",  "يهزم": "hzm",  "هزمة": "hzm",
  // tech (extended)
  "تقن": "tqn",  "يتقن": "tqn",  "تقنة": "tqn",
  "برم": "brm",  "يبرم": "brm",  "برمة": "brm",
  "هند": "hnd",  "يهند": "hnd",  "هندة": "hnd",
  // quality (extended)
  "صفي": "Sfy",  "يصفي": "Sfy",  "صفية": "Sfy",
  "جود": "jwd",  "يجود": "jwd",  "جودة": "jwd",
  "حسن": "Hsn",  "يحسن": "Hsn",  "حسنة": "Hsn",
  "سوأ": "swa",  "يسوأ": "swa",  "سوأة": "swa",
  "نظف": "nZf",  "ينظف": "nZf",  "نظفة": "nZf",
  "قبح": "qbH",  "يقبح": "qbH",  "قبحة": "qbH",
  "جدد": "jdd",  "يجدد": "jdd",  "جددة": "jdd",
  "صعب": "Seb",  "يصعب": "Seb",  "صعبة": "Seb",
  "كمم": "kmm",  "يكمم": "kmm",  "كممة": "kmm",
  "فضل": "fpl",  "يفضل": "fpl",  "فضلة": "fpl",
  "كمل": "kml",  "يكمل": "kml",  "كملة": "kml",
  // material (extended)
  "معد": "med",  "يمعد": "med",  "معدة": "med",
  "حجر": "Hjr",  "يحجر": "Hjr",  "حجرة": "Hjr",
  "فضض": "fpp",  "يفضض": "fpp",  "فضضة": "fpp",
  "نحس": "nHs",  "ينحس": "nHs",  "نحسة": "nHs",
  "خشب": "xcb",  "يخشب": "xcb",  "خشبة": "xcb",
  "زجج": "zjj",  "يزجج": "zjj",  "زججة": "zjj",
  "قمش": "qmc",  "يقمش": "qmc",  "قمشة": "qmc",
  "نسج": "nsj",  "ينسج": "nsj",  "نسجة": "nsj",
  // work (extended)
  "فعل": "fel",  "يفعل": "fel",  "فعلة": "fel",
  "نفذ": "nfD",  "ينفذ": "nfD",  "نفذة": "nfD",
};

// ── 4. Root → semantic field ─────────────────────────────────────────────────

const ROOT_FIELD: Record<string, string> = {
  // Write
  ktb:    "write", sjl:    "write", "ṭbʿ":  "write", "ʾnšʾ": "write",
  // Know
  "ʿlm":  "know",  "ʿrf":  "know",  "qrʾ":  "know",  fhm:    "know",
  "drss": "know",
  // Speak
  qwl:    "speak", tkl:    "speak", "ḥdṯ":  "speak", šrḥ:    "speak",
  "ʾʿln": "speak", "sʾl":  "speak", "ḵṭb":  "speak", jb:     "speak",
  // Send
  rsl:    "send",  wṣl:    "send",  "bṯṯ":  "send",
  // Move
  "ḥrk":  "move",  "ḏhb":  "move",  "jʾ":   "move",  mšy:    "move",
  sfr:    "move",  "rḍ":   "move",  "ḥml":  "move",  ntql:   "move",
  hjr:    "move",
  // Create
  "ṣnʿ":  "create",bny:   "create","ḵlq":  "create","ḵtrʿ": "create",
  "ṣmm":  "create",ntj:   "create","ṭwr":  "create",
  // Work
  "dr": "work",  "qwd": "govern",
  // Give
  "ʿṭy":  "give",  qddm:   "give",  mnḥ:    "give",  hdy:    "give",
  // Hold
  "ḥfẓ":  "hold",  mssk:   "hold",  "ḵzn":  "hold",  "ʾḵḏ":  "hold",
  "ḥmy":  "hold",
  // Think
  fkr:    "think", "ḵṭṭ":  "think", "ʿtqd": "think", "ḥll":  "think",
  // See
  "rʾy":  "see",   nẓr:    "see",   šhd:    "see",   "lḥẓ":  "see",
  // Feel
  "šʿr":  "feel",  "ḥss":  "feel",  "ḥbb":  "feel",  "ḵwf":  "feel",
  aml:    "feel",  "ʾrd":  "feel",  rġb:    "feel",  tmny:   "feel",
  krh:    "feel",
  // Exist
  kwn:    "exist", wjd:    "exist", "ʿyš":  "exist", ẓhr:    "exist",
  "ṣbḥ":  "exist",
  // Govern
  "ḥkm":  "govern",slṭ:   "govern",syst:   "govern",qnn:    "govern",
  // Fight
  "ḥrb":  "fight", qtl:    "fight", hjm:    "fight", dfʿ:    "fight",
  nzʿ:    "fight", hdm:    "fight",
  // Trade
  tjr:    "trade", šry:    "trade", "byʿ":  "trade", iqtṣd:  "trade",
  "swq": "trade",  "thmn": "trade",  "qd": "trade",  klf: "trade",
  // Food
  "ʾkl":  "food",  "ṭʿm":  "food",  "ṭbḵ":  "food",  wjbh:   "food",
  // Health
  "lj": "health",
  dws:    "health","ṣḥḥ":  "health",jrḥ:   "health",
  // Fix
  "ṣlḥ":  "fix",   rkmm:   "fix",   "ḥdṯu": "fix",   "ṣḥḥc": "fix",
  // Connect
  rbt:    "connect","ʾtṣl":"connect",dmj:   "connect",šbk:   "connect",
  // Destroy
  dmr:    "destroy",ksr:   "destroy",tlf:   "destroy",
  "qḍy":  "destroy","ḥḏf": "destroy",
  // Possess
  mlk:    "possess","ḥṣl": "possess",
  // Gather
  "jmʿ":  "gather", ltqy:  "gather", "ḥšd":  "gather",
  // Science
  fzyk:   "science",kmy:   "science","ʾḥyʾ":"science",ryḍyt: "science",
  "tjrb": "science",  "br": "science",  "jyl": "science",
  flk:    "science",
  // Tech
  tqn:    "tech",  brmj:   "tech",  tṭbyq:  "tech",  "ḵwrzm":"tech",
  "ʾdb":  "tech",  "ḏkyʾ": "tech",  tšfyr:  "tech",  sybr:   "tech",
  "ʾtmt": "tech",  rwbt:   "tech",  sḥbh:   "tech",
  // Art
  rsmm:   "art",   mwsq:   "art",   "šʿrp": "art",   flm:    "art",
  msrḥ:   "art",   nqš:    "art",   tṣwrp:  "art",
  // Sport
  ryḍ:    "sport", kry:    "sport", sbq:    "sport", bṭl:    "sport",
  "lʿb":  "sport", tdrb:   "sport",
  // Nature
  "jbl": "nature",
  "bḥr":  "nature",nhr:   "nature","ṣḥrʾ":"nature",mnḵ:   "nature",
  // Weather
  "qs": "weather",
  "ḥrrh": "weather",šms:  "weather","ġym":  "weather",
  // Measure
  "ḥsb":  "measure",qys:  "measure","ʿdd": "measure","ḥwl": "measure",
  wzn:    "measure",msft:  "measure",
  // ─── CST root field import ─────────────────────────────────────────────────
  "axD": "take",
  "qbl": "take",
  "srq": "take",
  "nhb": "take",
  "xgf": "take",
  "slb": "take",
  "bdl": "change",
  "Gyr": "change",
  "nmw": "change",
  "zyd": "change",
  "skn": "exist",
  "emr": "exist",
  "nzl": "exist",
  "aqm": "exist",
  "glb": "feel",
  "tmn": "feel",
  "chw": "feel",
  "bGy": "feel",
  "Hwj": "feel",
  "lzm": "feel",
  "prr": "feel",
  "wjb": "feel",
  "qrr": "think",
  "fSl": "think",
  "ezm": "think",
  "raH": "exist",
  "nwm": "exist",
  "hda": "exist",
  "twq": "exist",
  "pmn": "hold",
  "Hwy": "hold",
  "cml": "hold",
  "mla": "hold",
  "frG": "hold",
  "xfy": "hold",
  "ktm": "hold",
  "Gyb": "hold",
  "Hjb": "hold",
  "xba": "hold",
  "bgn": "hold",
  "ftH": "fix",
  "Glq": "fix",
  "qfl": "fix",
  "str": "fix",
  "qwy": "fight",
  "pGg": "fight",
  "jbr": "fight",
  "qhr": "fight",
  "arG": "fight",
  "cdd": "fight",
  "ewn": "work",
  "nSr": "work",
  "sef": "work",
  "GwT": "work",
  "anq": "work",
  "mkn": "work",
  "aDn": "work",
  "smH": "work",
  "qdr": "work",
  "ysr": "work",
  "bcr": "social",
  "ins": "social",
  "rjl": "social",
  "mra": "social",
  "gfl": "social",
  "cyx": "social",
  "cbb": "social",
  "nsb": "social",
  "smy": "know",
  "lqb": "know",
  "enw": "know",
  "wsm": "know",
  "ckl": "create",
  "hyk": "create",
  "nZm": "create",
  "Sff": "create",
  "rtb": "create",
  "gbq": "create",
  "dwn": "write",
  "rqm": "write",
  "nsx": "write",
  "ncr": "write",
  "Sdr": "write",
  "wTq": "write",
  "SHf": "write",
  "Tqf": "know",
  "xbr": "know",
  "fqh": "know",
  "rcd": "know",
  "lqn": "know",
  "wey": "know",
  "klm": "speak",
  "ngq": "speak",
  "Srx": "speak",
  "ndy": "speak",
  "lGw": "speak",
  "Hky": "speak",
  "eln": "speak",
  "Dkr": "speak",
  "rwy": "speak",
  "sal": "speak",
  "jwb": "speak",
  "fsr": "speak",
  "wSf": "speak",
  "byn": "speak",
  "eql": "think",
  "ray": "think",
  "Znn": "think",
  "xmn": "think",
  "zem": "think",
  "bSr": "see",
  "lHZ": "see",
  "lmH": "see",
  "rqb": "see",
  "tbe": "see",
  "rSd": "see",
  "Hbb": "feel",
  "Hzn": "feel",
  "frH": "feel",
  "Gpb": "feel",
  "qlq": "feel",
  "rpy": "feel",
  "ndm": "feel",
  "alm": "feel",
  "sed": "feel",
  "Hnn": "feel",
  "ecq": "feel",
  "Hyr": "feel",
  "Der": "feel",
  "fze": "feel",
  "rje": "move",
  "syr": "move",
  "rHl": "move",
  "jry": "move",
  "gyr": "move",
  "ebr": "move",
  "hbg": "move",
  "Sed": "move",
  "dxl": "move",
  "xrj": "move",
  "frr": "move",
  "sbH": "move",
  "qfz": "move",
  "zHf": "move",
  "rkb": "move",
  "egy": "give",
  "whb": "give",
  "tbr": "give",
  "cyd": "create",
  "anc": "create",
  "Hgm": "destroy",
  "mHq": "destroy",
  "fny": "destroy",
  "Hrq": "destroy",
  "Grq": "destroy",
  "xrb": "destroy",
  "edm": "destroy",
  "Hyw": "exist",
  "bqy": "exist",
  "eyc": "exist",
  "wqt": "time",
  "zmn": "time",
  "trx": "time",
  "bdq": "time",
  "nhy": "time",
  "xtm": "time",
  "mhl": "time",
  "mwp": "place",
  "bld": "place",
  "mdn": "place",
  "qry": "place",
  "mng": "place",
  "Hdd": "place",
  "qgr": "place",
  "wly": "place",
  "Hwz": "possess",
  "ksb": "possess",
  "fqd": "possess",
  "Hrm": "possess",
  "cry": "trade",
  "rbH": "trade",
  "xsr": "trade",
  "jhd": "fight",
  "npl": "fight",
  "dfe": "fight",
  "qwm": "fight",
  "Gzw": "fight",
  "sys": "govern",
  "amr": "govern",
  "rs": "govern",
  "bde": "create",
  "wld": "create",
  "fgr": "create",
  "jsm": "body",
  "ras": "body",
  "ydy": "body",
  "qlb": "body",
  "eyn": "body",
  "sme": "body",
  "dmm": "body",
  "eZm": "body",
  "lHm": "body",
  "jld": "body",
  "akl": "food",
  "gem": "food",
  "jwe": "food",
  "egc": "food",
  "Dwq": "food",
  "hpm": "food",
  "GDy": "food",
  "arp": "nature",
  "brr": "nature",
  "SHr": "nature",
  "Gab": "nature",
  "wad": "nature",
  "shl": "nature",
  "Hrr": "weather",
  "brd": "weather",
  "Gym": "weather",
  "eSf": "weather",
  "fyp": "weather",
  "jff": "weather",
  "smk": "animal",
  "Hcr": "animal",
  "Db": "animal",
  "asd": "animal",
  "frs": "animal",
  "bqr": "animal",
  "Gnm": "animal",
  "jml": "animal",
  "klb": "animal",
  "zre": "plant",
  "nbt": "plant",
  "cjr": "plant",
  "Tmr": "plant",
  "zhr": "plant",
  "HSd": "plant",
  "Grs": "plant",
  "rwp": "plant",
  "lwn": "color",
  "byp": "color",
  "swd": "color",
  "Hmr": "color",
  "xpr": "color",
  "zrq": "color",
  "Sfr": "color",
  "kbr": "size",
  "SGr": "size",
  "qSr": "size",
  "wse": "size",
  "pyq": "size",
  "emq": "size",
  "kTr": "size",
  "qll": "size",
  "msH": "measure",
  "qrb": "measure",
  "nSf": "measure",
  "pmm": "connect",
  "cbk": "connect",
  "elq": "connect",
  "zwj": "connect",
  "qbp": "hold",
  "rfe": "hold",
  "lmm": "gather",
  "jny": "gather",
  "beT": "send",
  "wjh": "send",
  "nql": "send",
  "bTT": "send",
  "crk": "social",
  "jwr": "social",
  "ahl": "social",
  "ceb": "social",
  "amm": "social",
  "Hzb": "social",
  "fnn": "art",
  "zxr": "art",
  "lHn": "art",
  "Gny": "art",
  "ezf": "art",
  "rqS": "art",
  "mTl": "art",
  "fHS": "science",
  "rkz": "science",
  "mrs": "science",
  "ryp": "sport",
  "fwz": "sport",
  "hzm": "sport",
  "brm": "tech",
  "hnd": "tech",
  "Sfy": "quality",
  "jwd": "quality",
  "Hsn": "quality",
  "swa": "quality",
  "nZf": "quality",
  "qbH": "quality",
  "jdd": "quality",
  "Seb": "quality",
  "kmm": "quality",
  "fpl": "quality",
  "kml": "quality",
  "med": "material",
  "Hjr": "material",
  "fpp": "material",
  "nHs": "material",
  "xcb": "material",
  "zjj": "material",
  "qmc": "material",
  "nsj": "material",
  "fel": "work",
  "nfD": "work",
};

// ── 5a. Direct vocabulary — Arabic words with no derivational pattern ─────────
// Maps normalized Arabic word (post-segment) → semantic field directly.
// Covers animals, colors, body parts, specific foods, materials, places, etc.

const DIRECT_FIELD: Record<string, string> = {
  // ── Animals ──────────────────────────────────────────────────────────────
  "كلب":      "animal", "قطه":     "animal", "اسد":     "animal",
  "نمر":      "animal", "فيل":     "animal", "حصان":    "animal",
  "بقره":     "animal", "جمل":     "animal", "طير":     "animal",
  "سمكه":     "animal", "ثعلب":    "animal", "ذئب":     "animal",
  "ارنب":     "animal", "دب":      "animal", "قرد":     "animal",
  "حيوان":    "animal", "حيوانات": "animal",
  "حشره":     "animal", "نحله":    "animal", "فراشه":   "animal",
  "طيور":     "animal", "اسماك":   "animal",
  "غزال":     "animal", "زرافه":   "animal", "تمساح":   "animal",
  "ثعبان":    "animal", "ضفدع":    "animal", "عقرب":    "animal",
  // ── Plants ───────────────────────────────────────────────────────────────
  "شجره":     "plant",  "اشجار":   "plant",  "زهره":    "plant",
  "ازهار":    "plant",  "عشب":     "plant",  "نبات":    "plant",
  "نباتات":   "plant",  "ثمره":    "plant",  "فاكهه":   "plant",
  "ورود":     "plant",  "ورق":     "plant",  "جذر":     "plant",
  "غابه":     "plant",  "بذره":    "plant",  "ساق":     "plant",
  "صبار":     "plant",  "نخل":     "plant",  "قمح":     "plant",
  "شجيره":    "plant",
  // ── Body parts ────────────────────────────────────────────────────────────
  "يد":       "body",   "يدين":    "body",   "رجل":     "body",
  "قدم":      "body",   "راس":     "body",   "وجه":     "body",
  "عين":      "body",   "اعين":    "body",   "اذن":     "body",
  "انف":      "body",   "فم":      "body",   "اسنان":   "body",
  "لسان":     "body",   "رقبه":    "body",   "كتف":     "body",
  "ذراع":     "body",   "صدر":     "body",   "بطن":     "body",
  "ظهر":      "body",   "قلب":     "body",   "دماغ":    "body",
  "كبد":      "body",   "رئه":     "body",   "دم":      "body",
  "عظمه":     "body",   "جلد":     "body",   "عضله":    "body",
  "عصب":      "body",   "شريان":   "body",   "جسم":     "body",
  "جسد":      "body",   "ركبه":    "body",
  // ── Colors ────────────────────────────────────────────────────────────────
  "احمر":     "color",  "ازرق":    "color",  "اخضر":    "color",
  "اصفر":     "color",  "ابيض":    "color",  "اسود":    "color",
  "برتقالي":  "color",  "بنفسجي":  "color",  "بني":     "color",
  "رمادي":    "color",  "ذهبي":    "color",  "فضي":     "color",
  "وردي":     "color",  "زيتوني":  "color",  "كحلي":    "color",
  "لون":      "color",  "الوان":   "color",
  // ── Materials ─────────────────────────────────────────────────────────────
  "خشب":      "material","حديد":   "material","صلب":    "material",
  "زجاج":     "material","قماش":   "material","خيش":    "material",
  "حجر":      "material","رخام":   "material","نحاس":   "material",
  "ذهب":      "material","فضه":    "material","قطن":    "material",
  "حرير":     "material","صوف":    "material","بلاستيك":"material",
  "ورق_ورق":  "material","كرتون":  "material","اسمنت":  "material",
  "طين":      "material","رمل":    "material",
  // ── Foods (specific) ─────────────────────────────────────────────────────
  "خبز":      "food",   "ارز":     "food",   "لحم":     "food",
  "دجاج":     "food",   "سمك":     "food",   "جبن":     "food",
  "بيض":      "food",   "حليب":    "food",   "زيت":     "food",
  "ملح":      "food",   "سكر":     "food",   "دقيق":    "food",
  "تمر":      "food",   "تفاح":    "food",   "موز":     "food",
  "برتقال":   "food",   "طماطم":   "food",   "بصل":     "food",
  "ثوم":      "food",   "فلفل":    "food",   "بازلاء":  "food",
  "عدس":      "food",   "حمص":     "food",   "شاي":     "food",
  "قهوه":     "food",   "مياه":    "food",   "عصير":    "food",
  "حلوى":     "food",   "كعك":     "food",
  // ── Time ─────────────────────────────────────────────────────────────────
  "وقت":      "time",   "زمن":     "time",   "يوم":     "time",
  "ايام":     "time",   "ليله":    "time",   "صباح":    "time",
  "مساء":     "time",   "ظهيره":   "time",   "اسبوع":   "time",
  "اسابيع":   "time",   "شهر":     "time",   "اشهر":    "time",
  "سنه":      "time",   "سنوات":   "time",   "ساعه":    "time",
  "دقيقه":    "time",   "ثانيه":   "time",   "تاريخ":   "time",
  "موعد":     "time",   "مواعيد":  "time",   "جدول":    "time",
  "الاحد":    "time",   "الاثنين": "time",   "الثلاثاء":"time",
  "الاربعاء": "time",   "الخميس":  "time",   "الجمعه":  "time",
  "السبت":    "time",   "رمضان":   "time",   "عيد":     "time",
  // ── Place ─────────────────────────────────────────────────────────────────
  "مكان":     "place",  "اماكن":   "place",  "مدينه":   "place",
  "مدن":      "place",  "بلد":     "place",  "بلدان":   "place",
  "شارع":     "place",  "شوارع":   "place",  "مطار":    "place",
  "محطه":     "place",  "فندق":    "place",  "مطعم":    "place",
  "مستشفى":   "place",  "مدرسه":   "place",  "جامعه":   "place",
  "مسجد":     "place",  "كنيسه":   "place",  "سوق":     "place",
  "ميدان":    "place",  "مركز":    "place",  "قريه":    "place",
  "حي":       "place",  "منطقه":   "place",  "عاصمه":   "place",
  "قاره":     "place",  "جزيره":   "place",  "ساحل":    "place",
  // ── Social / People ────────────────────────────────────────────────────────
  "انسان":    "social", "شخص":     "social", "ناس":     "social",
  "مجتمع":    "social", "اسره":    "social", "عائله":   "social",
  "صديق":     "social", "اصدقاء":  "social", "جار":     "social",
  "طفل":      "social", "شيخ":     "social", "مراه":    "social",
  "شباب":     "social", "مواطن":   "social", "شعب":     "social",
  "جيل":      "social", "تعاون":   "social",
  // ── Quality / State ───────────────────────────────────────────────────────
  "جيد":      "quality","ممتاز":   "quality","رديء":    "quality",
  "جميل":     "quality","قبيح":    "quality","كبير":    "quality",
  "صغير":     "quality","طويل":    "quality","قصير":    "quality",
  "سريع":     "quality","بطيء":    "quality","قوي":     "quality",
  "ضعيف":     "quality","ذكي":     "quality","صعب":     "quality",
  "سهل":      "quality","مختلف":   "quality","مشابه":   "quality",
  "مهم":      "quality","ضروري":   "quality","جديد":    "quality",
  "قديم":     "quality","اصلي":    "quality","نفس":     "quality",
  // ── Measure units ─────────────────────────────────────────────────────────
  "كيلومتر":  "measure","متر":     "measure","سنتيمتر": "measure",
  "كيلوجرام": "measure","جرام":    "measure","طن":      "measure",
  "درجه":     "measure","نسبه":    "measure","مئه":     "measure",
  "الف":      "measure","مليون":   "measure","مليار":   "measure",
  "نصف":      "measure","ثلث":     "measure","ربع":     "measure",
  "مساحه":    "measure","حجم":     "measure",
  // ── Sport specifics ───────────────────────────────────────────────────────
  "تنس":      "sport",  "سباحه":   "sport",  "جري":     "sport",
  "ملاكمه":   "sport",  "غوص":     "sport",  "تسلق":    "sport",
  "فريق":     "sport",  "لاعبون":  "sport",  "مباراه":  "sport",
  "ملعب":     "sport",  "هدف":     "sport",  "نتيجه":   "sport",
  // ── Science specifics ─────────────────────────────────────────────────────
  "ذره":      "science","جزيء":    "science","نواه":    "science",
  "دنا":      "science","مورثات":  "science","خليه":    "science",
  "طاقه":     "science","جاذبيه":  "science","كهرباء":  "science",
  "مغناطيس":  "science","ضوء":     "science","موجه":    "science",
  "اشعه":     "science","فضاء":    "science","كوكب":    "science",
  "نجم":      "science","مجره":    "science","كون":     "science",
  // ── Tech specifics ────────────────────────────────────────────────────────
  "هاتف":     "tech",   "حاسب":    "tech",
  "شاشه":     "tech",   "كاميرا":  "tech",   "طابعه":   "tech",
  "ذاكره":    "tech",   "معالج":   "tech",   "بطاريه":  "tech",
  "شاحن":     "tech",   "بلوتوث":  "tech",
  // ─── Extended direct field entries (CST import) ─────────────────────────────
  // Social / Person
  "رئيس":    "social",  "وزير":    "social",  "مسؤول":   "social",
  "قائد":    "social",  "مدير":    "social",  "مسئول":   "social",
  "رجال":    "social",  "نساء":    "social",  "أطفال":   "social",
  "عمال":    "social",  "طلاب":    "social",
  "أسرة":    "social",  "عائلة":   "social",  "جيران":   "social",
  "زميل":    "social",  "شريك":    "social",
  "حضارة":   "social",  "ثقافة":   "social",  "تراث":    "social",
  "أمة":     "social",  "شعوب":    "social",
  // Govern / Politics
  "انتخاب":  "govern",  "برلمان":  "govern",  "ديمقراطية":"govern",
  "دستور":   "govern",  "سياسة":   "govern",  "قانون":   "govern",
  "محكمة":   "govern",  "قضاء":    "govern",  "عدالة":   "govern",
  "حكومة":   "govern",  "دولة":    "govern",  "سيادة":   "govern",
  "جمهورية": "govern",  "ملكية":   "govern",  "وزارة":   "govern",
  "بعثة":    "govern",  "سفارة":   "govern",  "معاهدة":  "govern",
  "قرار":    "govern",  "مرسوم":   "govern",  "لائحة":   "govern",
  // Trade / Finance
  "فاتورة":  "trade",   "إيصال":   "trade",   "ضريبة":   "trade",
  "رسوم":    "trade",   "عمولة":   "trade",   "ودائع":   "trade",
  "استثمار": "trade",   "تمويل":   "trade",   "ميزانية": "trade",
  "اقتصاد":  "trade",   "بورصة":   "trade",   "أسهم":    "trade",
  "سندات":   "trade",   "صادرات":  "trade",   "واردات":  "trade",
  "تجارة":   "trade",   "شركة":    "trade",   "مؤسسة":   "trade",
  // Health / Medicine
  "عيادة":   "health",  "طبيب":    "health",
  "دواء":    "health",  "علاج":    "health",  "جراحة":   "health",
  "تشخيص":   "health",  "أمراض":   "health",  "وباء":    "health",
  "حجر صحي": "health",  "لقاح":    "health",  "فيروس":   "health",
  "بكتيريا": "health",  "مناعة":   "health",  "تغذية":   "health",
  // Science / Research
  "فرضية":   "science", "نظرية":   "science", "دليل":    "science",
  "إحصاء":   "science", "ذرة":     "science", "خلية":    "science",
  "جين":     "science", "تطور":    "science", "تجربة":   "science",
  "مختبر":   "science", "منهج":    "science", "بيانات":  "science",
  // Tech
  "ذكاء اصطناعي": "tech", "تعلم آلي": "tech",
  "شبكة":    "tech",   "خادم":    "tech",   "برنامج":  "tech",
  "تطبيق":   "tech",   "منصة":    "tech",   "واجهة":   "tech",
  "قاعدة بيانات": "tech", "خوارزمية": "tech",
  "تشفير":   "tech",   "أمن معلومات": "tech",
  "نظام تشغيل": "tech", "سحابة":  "tech",
  // Quality
  "مشروع":   "quality", "معقول":   "quality",
  "متوسط":   "quality", "فعال":   "quality",
  "كفوء":    "quality", "موثوق":   "quality",
  "شامل":    "quality", "عاجل":    "quality", "مستدام": "quality",
  // Art / Culture
  "موسيقى":  "art",    "رسم":     "art",    "نحت":     "art",
  "شعر":     "art",    "رواية":   "art",    "مسرح":    "art",
  "سينما":   "art",    "فن":      "art",
  "تصوير":   "art",    "أدب":     "art",    "فلسفة":   "art",
  // Sport
  "كرة قدم": "sport",  "كرة سلة": "sport",
  "سباحة":   "sport",  "تدريب":   "sport",
  "بطولة":   "sport",  "منافسة":  "sport",  "رياضي":   "sport",
  // Food / Nutrition
  "خضروات":  "food",   "فواكه":   "food",   "لحوم":    "food",
  "مأكولات": "food",   "مشروبات": "food",   "وصفة":    "food",
  "مطبخ":    "food",   "طاجن":    "food",   "حساء":    "food",
  // Nature / Environment
  "بيئة":    "nature", "مناخ":    "nature", "تلوث":    "nature",
  "استدامة": "nature", "طاقة متجددة": "nature", "تنوع حيوي": "nature",
  // Animal
  "أسماك":   "animal",
  "حشرات":   "animal", "ثدييات":  "animal",
  // Place / Geography
  "عاصمة":   "place",  "مدينة":   "place",  "قرية":    "place",
  "منطقة":   "place",  "إقليم":   "place",  "محافظة":  "place",
  "حدود":    "place",
  // Material
  "خامات":   "material","معادن":  "material",
  "كيمياء":  "material","خليط":   "material","سبيكة":  "material",
  // ── High-frequency customer/agent nouns (production coverage) ─────────────
  // Account / money / cost
  "حساب":    "trade",   "حسابات":  "trade",
  "مبلغ":    "trade",   "مبالغ":   "trade",
  "تكلفة":   "trade",   "كلفة":    "trade",
  "غرامة":   "trade",
  // Refund / cancellation / subscription
  "استرداد": "trade",   "إرجاع":   "trade",
  "إلغاء":   "trade",   "اشتراك":  "trade",   "اشتراكات":"trade",
  "باقة":    "trade",   "باقات":   "trade",
  // Request / order / shipping
  "طلبات":   "trade",   "شحن":     "trade",
  // Blocked / broken / disrupted states
  "محظور":   "fix",     "معطل":    "fix",
  "خلل":     "fix",     "مشكلة":   "fix",     "مشاكل":   "fix",
  "أعطال":   "fix",
  // User / account
  "إيميل":   "send",
  "مستخدم":  "social",  "مستخدمون":"social",
  // Appointment / booking
  "حجز":     "trade",   "حجوزات":  "trade",
  "تأجير":   "trade",   "استئجار": "trade",
  // Need / want (noun forms + Form VIII verbs)
  "حاجة":    "feel",    "رغبة":    "feel",    "احتياج": "feel",
  "احتاج":   "feel",    "يحتاج":   "feel",
  "اريد":    "feel",    "يريد":    "feel",    // أريد normalized
  // Common Form VIII verbs (اِفْتَعَلَ pattern)
  "اختار":   "think",   "يختار":   "think",   // choose
  "انتظر":   "time",    "ينتظر":   "time",    // wait
  "اكتسب":   "trade",   "يكتسب":   "trade",   // acquire
  "اشترك":   "trade",   "يشترك":   "trade",   // subscribe/join (verb form)
  // Notification / announcement
  "تذكير":   "think",   "تنبيه":   "think",   "إشعار":  "send",
  "إعلان":   "send",
  // Delivery / receipt
  "توصيل":   "send",    "استلام": "take",
  // Policy / terms
  "شروط":    "govern",  "لوائح":  "govern",
};

// ── 5b. Pre-normalized lookup tables ────────────────────────────────────────
// Build at module-init so tokenizeAr() does a single O(1) lookup per stem.
// Covers ى→ي, آ/أ/إ→ا, ؤ→و normalization mismatches automatically.

const _ROOT_MAP_NORM: Record<string, string> = {};
for (const [k, v] of Object.entries(ROOT_MAP)) {
  if (k.includes(" ")) continue;            // skip multi-word (→ COMPOUND_FIELDS_AR)
  _ROOT_MAP_NORM[normalize(k)]           = v;
  _ROOT_MAP_NORM[normalize(segment(k))]  = v;
}

const _DIRECT_FIELD_NORM: Record<string, string> = {};
for (const [k, v] of Object.entries(DIRECT_FIELD)) {
  if (k.includes(" ")) continue;
  _DIRECT_FIELD_NORM[normalize(k)]           = v;
  _DIRECT_FIELD_NORM[normalize(segment(k))]  = v;
}

// ── 5c. Compound Arabic phrases (bigram pre-scan, like English COMPOUND_FIELDS)
export const COMPOUND_FIELDS_AR: Record<string, string> = {
  // Technology / AI
  "ذكاء اصطناعي":   "tech",
  "تعلم الة":        "know",
  "تعلم آلي":        "know",
  "شبكه عصبيه":      "tech",
  "معالجه لغه":      "speak",
  "واجهه مستخدم":    "tech",
  "قاعده بيانات":    "tech",
  "امن معلومات":     "tech",
  "امن سيبراني":     "tech",
  "حوسبه سحابيه":    "tech",
  "تعلم عميق":       "know",
  "واي فاي":         "tech",
  "بلوتوث اله":      "tech",
  "لوحه مفاتيح":     "tech",
  // Health
  "صحه نفسيه":       "health",
  "ضغط دم":          "health",
  "سكر دم":          "health",
  "اشعه سينيه":      "health",
  "علاج طبيعي":      "health",
  "اسعاف اولي":      "health",
  "عمليه جراحيه":    "health",
  // Science
  "تغيير مناخي":     "weather",
  "تغير مناخ":       "weather",
  "احتباس حراري":    "weather",
  "نظام شمسي":       "science",
  "ثقب اسود":        "science",
  "نظريه كم":        "science",
  "نظام بيئي":       "nature",
  "احوال جويه":      "weather",
  "درجه حراره":      "weather",
  // Sport
  "كره قدم":         "sport",
  "كره سله":         "sport",
  "كره طائره":       "sport",
  "كره يد":          "sport",
  "العاب قوى":       "sport",
  "سباق سيارات":     "sport",
  "كاس عالم":        "sport",
  // Social / Media
  "وسائل تواصل":     "send",
  "تواصل اجتماعي":   "send",
  "وسائل اعلام":     "send",
  // Economy / Trade
  "سوق مال":         "trade",
  "سعر صرف":         "trade",
  "فائده مركبه":     "trade",
  // Time
  "وقت حقيقي":       "time",
  "منطقه زمنيه":     "time",
  // Fight / Conflict
  "حرب اهليه":       "fight",
  // Extended compounds (CST import)
  "علاج نفسي":       "health",
  "مرض عقلي":        "health",
  "أمان غذائي":      "food",
  "فيلم وثائقي":     "art",
  "موسيقى شعبية":    "art",
  "أدب عربي":        "art",
  "اقتصاد سياسي":    "govern",
  "حقوق إنسان":      "govern",
  "انتخابات عامة":   "govern",
  "قانون دولي":      "govern",
  "أمن قومي":        "govern",
  "طاقة شمسية":      "science",
  "طاقة متجددة":     "science",
  "حمض نووي":        "science",
  "خلية عصبية":      "science",
  "قاعدة بيانات":    "tech",
  "أمن معلومات":     "tech",
  "نظام تشغيل":      "tech",
  "نباتات مائية":    "plant",
  "حيوانات برية":    "animal",
  "ثروة طبيعية":     "nature",
  "تغير مناخي":      "nature",
  "كرة القدم":       "sport",
  "ألعاب أولمبية":   "sport",
  "تدريب بدني":      "sport",
  "عقد عمل":         "work",
  "سوق عمل":         "trade",
  "حد أدنى":         "measure",
  "حد أقصى":         "measure",
  // Production bigrams
  "كلمة مرور":       "tech",
  "رمز مرور":        "tech",
  "بريد إلكتروني":   "send",
  "ملف تعريف":       "social",
};


const STRUCTURAL_MAP_AR: Record<string, TokenType> = {
  // Negation
  "لا":    "NEG",
  "لم":    "NEG",
  "لن":    "NEG",
  "ما":    "NEG",
  "ليس":   "NEG",
  "مش":    "NEG",    // colloquial (Egyptian/Levantine)
  "مو":    "NEG",    // colloquial (Gulf)
  "غير":   "NEG",    // non- / un-
  // Questions
  "هل":    "QUERY",
  "ا":     "QUERY",  // أ question prefix (rare)
  "ماذا":  "WHAT_Q",
  "من":    "WHO_Q",
  "اي":    "WHICH_Q",
  "اين":   "WHERE_Q",
  "متى":   "WHEN_Q",
  "لماذا": "WHY_Q",
  "كيف":   "HOW_Q",
  "كم":    "WHAT_Q",
  // Condition
  "اذا":   "COND",
  "لو":    "COND",
  "ان":    "COND",   // إن conditional
  // Cause
  "لان":   "CAUSE",
  "بسبب":  "CAUSE",
  "لذلك":  "CAUSE",
  "لذا":   "CAUSE",
  "نتيجه": "CAUSE",
  // Future
  "سوف":   "FUTURE",
  "ستكون": "FUTURE",
  // Past
  "كان":   "PAST",
  "كانت":  "PAST",
  "كانوا": "PAST",
  "كنت":   "PAST",
  // Modal — ability
  "يمكن":   "MODAL",
  "يستطيع": "MODAL",
  "قادر":   "MODAL",
  "يقدر":   "MODAL",
  "قدره":   "MODAL",
  // Modal — obligation
  "يجب":    "MODAL",
  "ينبغي":  "MODAL",
  "لازم":   "MODAL",
  "ضروري":  "MODAL",
  "واجب":   "MODAL",
  // Modal — possibility
  "ربما":   "MODAL",
  "لعل":    "MODAL",
  "عسى":    "MODAL",
  "احتمال": "MODAL",
  "ممكن":   "MODAL",
};

/** Arabic words treated as function words (dropped). */
const FUNCTION_WORDS_AR = new Set([
  // Pronouns
  "هو", "هي", "هم", "هن", "نحن", "انا", "انت", "انتم", "انتن",
  // Demonstratives
  "هذا", "هذه", "ذلك", "تلك", "هؤلاء", "اولئك",
  // Common particles / prepositions (content covered by RELATION_MAP_AR)
  "في", "على", "مع", "الى", "عن", "من", "ب", "ل",
  // Aspectual / discourse particles
  "قد", "ثم", "ايضا", "فقط", "جدا", "بل", "حتى", "كذلك",
  "تماما", "نفس", "فعلا", "طبعا", "بالطبع", "بالفعل",
]);
// ── 6. Relation words ────────────────────────────────────────────────────────
const RELATION_MAP_AR: Record<string, string> = {
  "الى":    "REL:to",
  "نحو":    "REL:to",
  "من":     "REL:from",
  "مع":     "REL:with",
  "بدون":   "REL:without",
  "في":     "REL:in",
  "على":    "REL:on",
  "تحت":    "REL:under",
  "فوق":    "REL:above",
  "عن":     "REL:about",
  "بين":    "REL:between",
  "خارج":   "REL:outside",
  "داخل":   "REL:in",
  "و":      "REL:and",
  "او":     "REL:or",
  "لكن":    "REL:but",
  "قبل":    "REL:before",
  "بعد":    "REL:after",
  "خلال":   "REL:during",
  "منذ":    "REL:since",
  "حتى":    "REL:until",
  "بسبب":   "REL:causes",
  "ضد":     "REL:against",
  "حول":    "REL:about",
  "وراء":   "REL:behind",
  "امام":   "REL:before",
  "بجانب":  "REL:beside",
  "عبر":    "REL:via",
  "لكل":    "REL:for",
  "حسب":    "REL:per",
  // Extended relations (CST import)
  "لدى":    "REL:at",
  "عند":    "REL:at",
  "خلف":   "REL:behind",
  "إذ":    "REL:as",
  "كي":    "REL:for",
  "حيث":   "REL:where",
  "لأن":   "REL:causes",
  "بينما":  "REL:contrast",
  "كما":   "REL:like",
  "مثل":   "REL:like",
  "حين":   "REL:when",
  "عندما":  "REL:when",
  "إلا":   "REL:except",
  "سوى":   "REL:except",
  "كل":    "REL:all",
  "بعض":   "REL:some",
  "جميع":  "REL:all",
  "معظم":  "REL:most",
  "كثير":  "REL:many",
  "قليل":  "REL:few",
  "أكثر":  "REL:more",
  "أقل":   "REL:less",
  "أيضا":  "REL:also",
  "فقط":   "REL:only",

  "ثم":    "REL:then",
  "لأجل":  "REL:for",
};

// ── 7b. Pre-normalized STRUCTURAL and RELATION lookups ──────────────────────
// Built after map definitions so normalize() mismatches (ى→ي, إ→ا, etc.) are
// handled automatically at lookup time.

const _STRUCTURAL_NORM: Record<string, TokenType> = {};
for (const [k, v] of Object.entries(STRUCTURAL_MAP_AR)) {
  _STRUCTURAL_NORM[normalize(k)] = v;
}

const _RELATION_NORM: Record<string, string> = {};
for (const [k, v] of Object.entries(RELATION_MAP_AR)) {
  _RELATION_NORM[normalize(k)] = v;
}

// ── 7c. Pre-normalized FUNCTION_WORDS set ────────────────────────────────────
const _FUNCTION_WORDS_NORM = new Set<string>();
for (const w of FUNCTION_WORDS_AR) {
  _FUNCTION_WORDS_NORM.add(normalize(w));
}

// ── 8. Arabic morphological role detector ────────────────────────────────────
// Applied only AFTER a field is already identified from root/direct lookup.
// Detects common Arabic derivational patterns on the post-normalize stem.
//
// Patterns (no diacritics):
//   فاعل (fāʿil)   C + ا + C + C        len 4, [1] == ا  → agent
//   فاعله          C + ا + C + C + ه    len 5, [1] == ا, ends ه → agent
//   مفعول (mafʿūl) م + C + C + و + C   len 5, [0]=='م', [3]=='و' → patient
//   تفعيل (tafʿīl) ت + C + C + ي + C   len 5, [0]=='ت', [3]=='ي' → process
//   مفعله/مَفعَل   starts م, ends ه, len 5-6           → place
//   فعاله          C + C + ا + C + ه    ends 'اله'/'الh' → instance

const ALEF  = "\u0627"; // ا
const MIM   = "\u0645"; // م
const TA    = "\u062A"; // ت
const WAW   = "\u0648"; // و
const YEH   = "\u064A"; // ي
const HAR   = "\u0647"; // ه (role detection)
function detectRoleAr(stem: string): string | undefined {
  const n = stem.length;
  if (n < 3) return undefined;
  // فاعل pattern (agent): C ا C C  → len 4, index 1 is ا
  if (n === 4 && stem[1] === ALEF) return "agent";
  // فاعله pattern (agent fem): C ا C C ه → len 5, [1]==ا, ends ه
  if (n === 5 && stem[1] === ALEF && stem[4] === HAR) return "agent";
  // مفعول pattern (patient): م C C و C → len 5, [0]==م, [3]==و
  if (n === 5 && stem[0] === MIM && stem[3] === WAW) return "patient";
  // مفعوله (patient fem): م C C و C ه → len 6, [0]==م, [3]==و, ends ه
  if (n === 6 && stem[0] === MIM && stem[3] === WAW && stem[5] === HAR) return "patient";
  // تفعيل pattern (process/instance): ت C C ي C → len 5, [0]==ت, [3]==ي
  if (n === 5 && stem[0] === TA && stem[3] === YEH) return "process";
  // مفعله pattern (place): م ... ه, len 5-6, [0]==م, ends ه
  if ((n === 5 || n === 6) && stem[0] === MIM && stem[n - 1] === HAR &&
      stem[3] !== WAW) return "place";
  return undefined;
}
// ── 8. Tokenizer ─────────────────────────────────────────────────────────────
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
export function tokenizeAr(sentence: string): CSTToken[] {
  const tokens: CSTToken[] = [];
  const norm  = normalize(sentence.replace(/[؟!.،]+$/, ""));
  const words = norm.split(/\s+/);

  if (sentence.trimEnd().endsWith("?") || sentence.trimEnd().endsWith("؟")) {
    tokens.push({ type: "QUERY", value: "QUERY", surface: "؟" });
  }

  // ── Compound bigram pre-scan (mirrors English COMPOUND_FIELDS logic) ────────
  const skipIdx = new Set<number>();
  for (let i = 0; i < words.length - 1; i++) {
    const w0 = words[i];
    const w1 = words[i + 1];
    if (!w0 || !w1) continue;
    const pairs = [
      `${w0} ${w1}`,
      `${segment(w0)} ${w1}`,
      `${w0} ${segment(w1)}`,
      `${segment(w0)} ${segment(w1)}`,
    ];
    let compoundField: string | undefined;
    for (const pair of pairs) {
      if (COMPOUND_FIELDS_AR[pair]) { compoundField = COMPOUND_FIELDS_AR[pair]; break; }
    }
    if (compoundField) {
      skipIdx.add(i);
      skipIdx.add(i + 1);
      tokens.push({
        type: "CONCEPT",
        value: `CONCEPT:${compoundField}`,
        surface: `${words[i]} ${words[i + 1]}`,
        field: compoundField,
      });
    }
  }

  // ── Per-word processing ────────────────────────────────────────────────────
  for (let idx = 0; idx < words.length; idx++) {
    if (skipIdx.has(idx)) continue;
    const rawWord = words[idx];
    const word = rawWord.trim();
    if (!word) continue;
    // Structural check (before segmentation — structural words are full tokens)
    const structural = _STRUCTURAL_NORM[word];
    if (structural) {
      tokens.push({ type: structural, value: structural, surface: word });
      continue;
    }
    // Relation check
    const rel = _RELATION_NORM[word];
    if (rel) {
      tokens.push({ type: "REL", value: rel, surface: word });
      continue;
    }
    // Function word check
    if (_FUNCTION_WORDS_NORM.has(word)) continue;
    // Sīn future prefix (سـ): سيكتب → FUTURE + rest as concept
    const SA_PREFIX = "\u0633"; // س
    if (word.startsWith(SA_PREFIX) && word.length > 2 && word !== "سوف") {
      tokens.push({ type: "FUTURE", value: "FUTURE", surface: word[0] });
      const rest  = word.slice(1);
      const rstem = segment(rest);
      const rroot = _ROOT_MAP_NORM[rstem] ?? _ROOT_MAP_NORM[rest];
      const rfield = rroot
        ? ROOT_FIELD[rroot]
        : (_DIRECT_FIELD_NORM[rstem] ?? _DIRECT_FIELD_NORM[rest]);
      if (rfield) {
        tokens.push({ type: "CONCEPT", value: `CONCEPT:${rfield}`, surface: word, field: rfield });
        const rrole = detectRoleAr(rstem);
        if (rrole) tokens.push({ type: "ROLE", value: `ROLE:${rrole}`, surface: word, role: rrole });
      } else {
        tokens.push({ type: "LIT", value: `LIT:${word}`, surface: word });
      }
      continue;
    }
    // Main path: segment → normalized root/direct lookup → CONCEPT (+ optional ROLE)
    // Uses _ROOT_MAP_NORM / _DIRECT_FIELD_NORM built at module init to handle
    // normalization variants (ى→ي, آ/أ→ا, etc.) automatically.
    const stem  = segment(word);
    let root  = _ROOT_MAP_NORM[stem] ?? _ROOT_MAP_NORM[word];
    let field = root
      ? ROOT_FIELD[root]
      : (_DIRECT_FIELD_NORM[stem] ?? _DIRECT_FIELD_NORM[word]);

    // Fallback: try stripping augmented-verb prefixes (Form V ت, Form X است, 1st-person ا)
    // This handles أريد → ريد, تتبع → تبع, استرداد → رداد-like stems, احتاج → حتاج etc.
    if (!field) {
      const aug = stripVerbAug(stem);
      if (aug !== stem) {
        const augRoot = _ROOT_MAP_NORM[aug];
        const augField = augRoot
          ? ROOT_FIELD[augRoot]
          : _DIRECT_FIELD_NORM[aug];
        if (augField) { root = augRoot; field = augField; }
      }
    }

    // Check role on both the stem AND the original normalized word.
    // Necessary because segment() may strip a meaningful prefix (e.g. ك from كاتب)
    // that would otherwise be recognized by the fāʿil pattern.
    const role = detectRoleAr(stem) ?? detectRoleAr(word);

    if (field && role) {
      tokens.push({ type: "CONCEPT", value: `CONCEPT:${field}`, surface: word, field });
      tokens.push({ type: "ROLE", value: `ROLE:${role}`, surface: word, role });
    } else if (field) {
      tokens.push({ type: "CONCEPT", value: `CONCEPT:${field}`, surface: word, field });
    } else if (role) {
      // Emit ROLE even without a field — parity with English tokenizer
      tokens.push({ type: "ROLE", value: `ROLE:${role}`, surface: word, role });
    } else {
      tokens.push({ type: "LIT", value: `LIT:${word}`, surface: word });
    }
  }

  return tokens;
}
/** Human-readable token stream for Arabic input. */
export function tokenStreamAr(sentence: string): string {
  return tokenizeAr(sentence)
    .map((t) => t.value)
    .join(" ");
}