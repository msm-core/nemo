"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPOUND_FIELDS_AR = void 0;
exports.tokenizeAr = tokenizeAr;
exports.tokenStreamAr = tokenStreamAr;
// ── 1. Normalisation ──────────────────────────────────────────────────────────
const DIACRITIC_RE = /[\u064B-\u065F\u0670]/g;
const TATWEEL_RE = /\u0640/g;
// Map variant forms of hamza/alef to canonical single character
const ALEF_VARIANTS = {
    "\u0622": "\u0627", // آ → ا
    "\u0623": "\u0627", // أ → ا
    "\u0625": "\u0627", // إ → ا
    "\u0671": "\u0627", // ٱ → ا
};
const YEH_VARIANTS = {
    "\u0649": "\u064A", // ى → ي
};
const WAW_VARIANTS = {
    "\u0624": "\u0648", // ؤ → و
};
const TA_MARBUTA = "\u0629"; // ة
const HA = "\u0647"; // ه
function normalize(text) {
    let s = text.replace(DIACRITIC_RE, "").replace(TATWEEL_RE, "");
    s = s.replace(/./g, (c) => ALEF_VARIANTS[c] ?? YEH_VARIANTS[c] ?? WAW_VARIANTS[c] ?? c);
    return s;
}
// ── 2. Clitic segmentation ───────────────────────────────────────────────────
// Order matters: longer prefixes first
const CONJUNCTIVE_PREFIXES = ["\u0648", "\u0641"]; // و ف  (and, so)
const PREP_PREFIXES = ["\u0628", "\u0644", "\u0643"]; // ب ل ك (by/with, for/to, like)
const DEF_ARTICLE = "\u0627\u0644"; // ال
const OBJECT_SUFFIXES = [
    "\u0647\u0645", // هم  them (masc)
    "\u0647\u0646", // هن  them (fem)
    "\u0643\u0645", // كم  you (pl)
    "\u0647\u0627", // ها  her/it
    "\u0647", // ه   him/it
    "\u0643", // ك   you (sg)
    "\u0646\u0627", // نا  us
];
/** Strip leading clitics + definite article, trailing object suffixes. Returns stem. */
function segment(word) {
    let s = word;
    // Conjunctive prefix (و / ف)
    for (const p of CONJUNCTIVE_PREFIXES) {
        if (s.startsWith(p) && s.length > p.length + 2) {
            s = s.slice(p.length);
            break;
        }
    }
    // Preposition prefix (ب / ل / ك)
    for (const p of PREP_PREFIXES) {
        if (s.startsWith(p) && s.length > p.length + 2) {
            s = s.slice(p.length);
            break;
        }
    }
    // Definite article ال
    if (s.startsWith(DEF_ARTICLE) && s.length > DEF_ARTICLE.length + 1) {
        s = s.slice(DEF_ARTICLE.length);
    }
    // Object suffixes (remove one)
    for (const suf of OBJECT_SUFFIXES) {
        if (s.endsWith(suf) && s.length > suf.length + 2) {
            s = s.slice(0, -suf.length);
            break;
        }
    }
    // Normalize tā-marbūṭah to hā (ة→ه) on stem end for root matching
    if (s.endsWith(TA_MARBUTA))
        s = s.slice(0, -1) + HA;
    return s;
}
// ── 3. Root table — Arabic stems (post-normalize + post-segment) → root code ──
// 700+ entries across all 40 CST semantic fields.
// Uses real Arabic characters (UTF-8) for maintainability.
const ROOT_MAP = {
    // ── Write / Document — ktb ───────────────────────────────────────────────
    "كتب": "ktb", "يكتب": "ktb", "كتابه": "ktb",
    "كتاب": "ktb", "كاتب": "ktb", "مكتوب": "ktb",
    "مكتبه": "ktb", "كتيب": "ktb", "كتابات": "ktb",
    // Document / Record — sjl
    "سجل": "sjl", "يسجل": "sjl", "تسجيل": "sjl",
    "مسجل": "sjl", "سجلات": "sjl",
    // Print / Publish — ṭbʿ
    "طبع": "ṭbʿ", "يطبع": "ṭbʿ", "طباعه": "ṭbʿ",
    "طابع": "ṭbʿ", "مطبوع": "ṭbʿ", "مطبعه": "ṭbʿ",
    // Compose / Draft — ʾnšʾ
    "انشا": "ʾnšʾ", "انشاء": "ʾnšʾ", "ينشئ": "ʾnšʾ",
    // ── Know / Learn — ʿlm ───────────────────────────────────────────────────
    "علم": "ʿlm", "يعلم": "ʿlm", "علوم": "ʿlm",
    "عالم": "ʿlm", "معلوم": "ʿlm", "تعلم": "ʿlm",
    "معلم": "ʿlm", "تعليم": "ʿlm", "علمي": "ʿlm",
    "تعليمي": "ʿlm", "معلومه": "ʿlm", "معلومات": "ʿlm",
    // Know / Recognize — ʿrf
    "عرف": "ʿrf", "يعرف": "ʿrf", "معرفه": "ʿrf",
    "معروف": "ʿrf", "عارف": "ʿrf",
    // Read — qrʾ
    "قرا": "qrʾ", "يقرا": "qrʾ", "قراءه": "qrʾ",
    "قارئ": "qrʾ", "مقروء": "qrʾ", "قراءات": "qrʾ",
    // Understand — fhm
    "فهم": "fhm", "يفهم": "fhm", "مفهوم": "fhm",
    "تفاهم": "fhm", "فاهم": "fhm",
    // Study / Research — drss
    "درس": "drss", "يدرس": "drss", "دراسه": "drss",
    "دراسات": "drss", "مدرسه": "drss", "مدرس": "drss",
    // Research — bḥṯ
    "بحث": "bḥṯ", "يبحث": "bḥṯ", "بحوث": "bḥṯ",
    "باحث": "bḥṯ", "مبحث": "bḥṯ",
    // Discover — kšf
    "كشف": "kšf", "يكشف": "kšf", "اكتشف": "kšf",
    "اكتشاف": "kšf", "كاشف": "kšf",
    // Educate — tʿlm
    "يتعلم": "tʿlm",
    "متعلم": "tʿlm",
    // ── Speak / Communicate — qwl ─────────────────────────────────────────────
    "قال": "qwl", "يقول": "qwl", "قول": "qwl",
    "مقال": "qwl", "اقوال": "qwl", "مقولات": "qwl",
    // Talk — tkl
    "تكلم": "tkl", "يتكلم": "tkl", "متكلم": "tkl",
    "كلام": "tkl", "كلمه": "tkl", "كلمات": "tkl",
    // Discuss — ḥdṯ
    "حدث": "ḥdṯ", "يحدث": "ḥdṯ", "حديث": "ḥdṯ",
    "محادثه": "ḥdṯ", "محدث": "ḥdṯ", "احاديث": "ḥdṯ",
    // Explain — šrḥ
    "شرح": "šrḥ", "يشرح": "šrḥ", "شارح": "šrḥ",
    "شروح": "šrḥ", "مشروح": "šrḥ", "تشريح": "šrḥ",
    // Announce — ʾʿln
    "اعلن": "ʾʿln", "يعلن": "ʾʿln", "اعلان": "ʾʿln",
    "معلن": "ʾʿln", "اعلانات": "ʾʿln",
    // Ask / Inquire — sʾl
    "سال": "sʾl", "يسال": "sʾl", "سؤال": "sʾl",
    "اسئله": "sʾl", "مسؤول": "sʾl",
    // Lecture / Speech — ḵṭb
    "خطب": "ḵṭb", "خطاب": "ḵṭb", "خطيب": "ḵṭb",
    "خطبه": "ḵṭb", "مخطوب": "ḵṭb",
    // Reply / Answer — jb
    "اجاب": "jb", "يجيب": "jb", "اجابه": "jb",
    "مجيب": "jb", "جواب": "jb", "اجوبه": "jb",
    // ── Send / Transmit — rsl ─────────────────────────────────────────────────
    "ارسل": "rsl", "يرسل": "rsl", "رساله": "rsl",
    "مرسل": "rsl", "ارسال": "rsl", "رسائل": "rsl",
    // Deliver — wṣl
    "وصل": "wṣl", "يوصل": "wṣl", "توصيل": "wṣl",
    "واصل": "wṣl", "موصول": "wṣl",
    // Broadcast — bṯṯ
    "يبث": "bṯṯ", "بث": "bṯṯ",
    "مذيع": "bṯṯ",
    // ── Move / Travel — ḥrk ───────────────────────────────────────────────────
    "حرك": "ḥrk", "يتحرك": "ḥrk", "حركه": "ḥrk",
    "متحرك": "ḥrk", "حراك": "ḥrk",
    // Go — ḏhb
    "ذهب": "ḏhb", "يذهب": "ḏhb", "ذهاب": "ḏhb",
    "ذاهب": "ḏhb",
    // Come — jʾ
    "جاء": "jʾ", "يجيء": "jʾ", "مجيء": "jʾ",
    // Walk — mšy
    "مشى": "mšy", "يمشي": "mšy", "مشي": "mšy",
    "ماشي": "mšy", "مشاه": "mšy",
    // Travel — sfr
    "سافر": "sfr", "يسافر": "sfr", "سفر": "sfr",
    "مسافر": "sfr", "سفرات": "sfr", "اسفار": "sfr",
    // Arrive — wṣl (arrive sense)
    "يصل": "wṣl", "وصول": "wṣl",
    // Run — rḍ
    "يركض": "rḍ", "ركض": "rḍ",
    // Carry / Transport — ḥml
    "يحمل": "ḥml", "حمل": "ḥml",
    "حامل": "ḥml", "محمول": "ḥml", "حمولات": "ḥml",
    // Move house / Migrate — ntql
    "انتقل": "ntql", "ينتقل": "ntql", "انتقال": "ntql",
    "هاجر": "hjr", "يهاجر": "hjr", "هجره": "hjr",
    "مهاجر": "hjr",
    // ── Create / Make — ṣnʿ ───────────────────────────────────────────────────
    "صنع": "ṣnʿ", "يصنع": "ṣnʿ", "صناعه": "ṣnʿ",
    "صانع": "ṣnʿ", "مصنوع": "ṣnʿ", "مصنع": "ṣnʿ",
    "صناعي": "ṣnʿ",
    // Build — bny
    "بنى": "bny", "يبني": "bny", "بناء": "bny",
    "مبني": "bny", "بنايه": "bny", "مباني": "bny",
    // Create / Generate — ḵlq
    "يخلق": "ḵlq", "خلق": "ḵlq",
    "خالق": "ḵlq", "مخلوق": "ḵlq", "خليقه": "ḵlq",
    // Invent — ḵtrʿ
    "اخترع": "ḵtrʿ", "يخترع": "ḵtrʿ", "اختراع": "ḵtrʿ",
    "مخترع": "ḵtrʿ",
    // Design — ṣmm
    "صمم": "ṣmm", "يصمم": "ṣmm", "تصميم": "ṣmm",
    "مصمم": "ṣmm", "تصاميم": "ṣmm",
    // Produce — ntj
    "انتج": "ntj", "ينتج": "ntj", "انتاج": "ntj",
    "منتج": "ntj", "منتجات": "ntj", "انتاجي": "ntj",
    // Develop / Improve — ṭwr
    "طور": "ṭwr", "يطور": "ṭwr", "تطوير": "ṭwr",
    "مطور": "ṭwr", "تطور": "ṭwr",
    // ── Work / Operate — ʿml ─────────────────────────────────────────────────
    "يعمل": "ʿml", "عمل": "ʿml",
    "عامل": "ʿml", "عمال": "ʿml", "معمل": "ʿml",
    "عملي": "ʿml", "اعمال": "ʿml",
    // Job / Employ — šġl
    "يشغل": "šġl", "شغل": "šġl",
    "شاغل": "šġl", "وظيفه": "šġl", "وظائف": "šġl",
    // Manage — ʾdr
    "ادار": "ʾdr", "يدير": "ʾdr", "اداره": "ʾdr",
    "مدير": "ʾdr", "ادارات": "ʾdr", "اداري": "ʾdr",
    // Lead — qwd
    "قاد": "qwd", "يقود": "qwd", "قياده": "qwd",
    "قائد": "qwd", "قادة": "qwd",
    // ── Give / Present — ʿṭy ─────────────────────────────────────────────────
    "اعطى": "ʿṭy", "يعطي": "ʿṭy", "عطاء": "ʿṭy",
    "معطي": "ʿṭy",
    // Present / Offer — qddm
    "قدم": "qddm", "يقدم": "qddm", "تقديم": "qddm",
    "مقدم": "qddm", "مقدمه": "qddm",
    // Grant / Donate — mnḥ
    "منح": "mnḥ", "يمنح": "mnḥ", "منحه": "mnḥ",
    "ممنوح": "mnḥ",
    // Gift — hdy
    "اهدى": "hdy", "يهدي": "hdy", "هديه": "hdy",
    "هدايا": "hdy",
    // Donate — tbrrʿ
    "يتبرع": "tbrrʿ", "تبرع": "tbrrʿ",
    "متبرع": "tbrrʿ", "تبرعات": "tbrrʿ",
    // Share — šrk
    "شارك": "šrk", "يشارك": "šrk", "مشاركه": "šrk",
    "مشارك": "šrk",
    // ── Hold / Keep / Store — ḥfẓ ─────────────────────────────────────────────
    "حفظ": "ḥfẓ", "يحفظ": "ḥfẓ", "محفوظ": "ḥfẓ",
    "حافظ": "ḥfẓ", "حفاظ": "ḥfẓ",
    // Keep / Maintain — ʾmsk
    "امسك": "mssk", "يمسك": "mssk", "مسك": "mssk",
    "ماسك": "mssk",
    // Store — ḵzn
    "يخزن": "ḵzn", "خزن": "ḵzn",
    "خازن": "ḵzn", "مخزن": "ḵzn", "مخزون": "ḵzn",
    // Take / Receive — ʾḵḏ
    "ياخذ": "ʾḵḏ", "اخذ": "ʾḵḏ",
    "اخيذ": "ʾḵḏ",
    // Preserve — ḥmy
    "حمى": "ḥmy", "يحمي": "ḥmy", "حمايه": "ḥmy",
    "حامي": "ḥmy", "محمي": "ḥmy",
    // ── Think / Reason — fkr ─────────────────────────────────────────────────
    "فكر": "fkr", "يفكر": "fkr", "فكره": "fkr",
    "تفكير": "fkr", "مفكر": "fkr", "افكار": "fkr",
    // Plan — ḵṭṭ
    "خطط": "ḵṭṭ", "يخطط": "ḵṭṭ", "خطه": "ḵṭṭ",
    "تخطيط": "ḵṭṭ", "مخطط": "ḵṭṭ",
    // Believe — ʿtqd
    "اعتقد": "ʿtqd", "يعتقد": "ʿtqd", "اعتقاد": "ʿtqd",
    "معتقد": "ʿtqd",
    // Analyze — ḥll
    "حلل": "ḥll", "يحلل": "ḥll", "تحليل": "ḥll",
    "محلل": "ḥll", "تحليلي": "ḥll",
    // Reason / Logic — mnṭq
    "منطق": "mnṭq", "منطقي": "mnṭq", "استنتج": "mnṭq",
    "استنتاج": "mnṭq",
    // Wonder / Imagine — tṣwr
    "يتصور": "tṣwr", "تصور": "tṣwr",
    "متصور": "tṣwr",
    // ── See / Observe — rʾy ───────────────────────────────────────────────────
    "راى": "rʾy", "يرى": "rʾy", "رؤيه": "rʾy",
    "مرئي": "rʾy", "رائي": "rʾy",
    // Look / Watch — nẓr
    "نظر": "nẓr", "ينظر": "nẓr", "نظرات": "nẓr",
    "ناظر": "nẓr", "منظور": "nẓr", "منظر": "nẓr",
    // Watch / Observe — šhd
    "شاهد": "šhd", "يشاهد": "šhd", "مشاهده": "šhd",
    "مشاهد": "šhd", "شهيد": "šhd",
    // Notice — lḥẓ
    "لاحظ": "lḥẓ", "يلاحظ": "lḥẓ", "ملاحظه": "lḥẓ",
    "ملاحظات": "lḥẓ",
    // Search / Find — bḥṯ
    // ── Feel / Sense — šʿr ───────────────────────────────────────────────────
    "شعر": "šʿr", "يشعر": "šʿr", "شعور": "šʿr",
    "مشاعر": "šʿr",
    // Sense — ḥss
    "احس": "ḥss", "يحس": "ḥss", "احساس": "ḥss",
    // Love — ḥbb
    "احب": "ḥbb", "يحب": "ḥbb", "حب": "ḥbb",
    "محبوب": "ḥbb", "حبيب": "ḥbb", "محبه": "ḥbb",
    // Fear — ḵwf
    "خاف": "ḵwf", "يخاف": "ḵwf", "خوف": "ḵwf",
    "خائف": "ḵwf", "مخيف": "ḵwf",
    // Hope — aml
    "يامل": "aml", "امل": "aml",
    "اماني": "aml",
    // Want / Desire — ʾrd
    "اراد": "ʾrd", "يريد": "ʾrd", "اراده": "ʾrd",
    // Desire — rġb
    "رغب": "rġb", "يرغب": "rġb", "رغبه": "rġb",
    "راغب": "rġb", "رغبات": "rġb",
    // Wish — tmny
    "تمنى": "tmny", "يتمنى": "tmny", "تمني": "tmny",
    "امنيه": "tmny",
    // Hate — krh
    "يكره": "krh", "كره": "krh",
    "كاره": "krh", "مكروه": "krh",
    // ── Exist / Be — kwn / wjd ────────────────────────────────────────────────
    "كان": "kwn", "يكون": "kwn", "كائن": "kwn",
    "وجد": "wjd", "يوجد": "wjd", "وجود": "wjd",
    "موجود": "wjd",
    // Live — ʿyš
    "عاش": "ʿyš", "يعيش": "ʿyš", "حياه": "ʿyš",
    "حي": "ʿyš", "احياء": "ʿyš",
    // Appear / Emerge — ẓhr
    "ظهر": "ẓhr", "يظهر": "ẓhr", "ظهور": "ẓhr",
    "ظاهر": "ẓhr", "ظاهره": "ẓhr",
    // Become — ṣbḥ
    "اصبح": "ṣbḥ", "يصبح": "ṣbḥ", "صبح": "ṣbḥ",
    // ── Govern / Lead — ḥkm ───────────────────────────────────────────────────
    "يحكم": "ḥkm", "حكم": "ḥkm",
    "حاكم": "ḥkm", "حكومه": "ḥkm", "محكوم": "ḥkm",
    "حكام": "ḥkm", "احكام": "ḥkm",
    // Rule / Control — slṭ
    "سيطر": "slṭ", "يسيطر": "slṭ", "سيطره": "slṭ",
    "سلطه": "slṭ", "سلطان": "slṭ", "مسيطر": "slṭ",
    // Administer — ʾdr (same as manage above, kept for field)
    // Political — syst
    "سياسه": "syst", "سياسي": "syst", "سياسيون": "syst",
    "دوله": "syst", "دول": "syst",
    // Law / Regulate — qnn
    "قانون": "qnn", "قانوني": "qnn", "تشريع": "qnn",
    "مشرع": "qnn",
    // ── Fight / Conflict — ḥrb ────────────────────────────────────────────────
    "حرب": "ḥrb", "يحارب": "ḥrb", "محاربه": "ḥrb",
    "حارب": "ḥrb", "حروب": "ḥrb",
    // Kill / Battle — qtl
    "قاتل": "qtl", "يقاتل": "qtl", "قتال": "qtl",
    "مقاتل": "qtl", "قتل": "qtl",
    // Attack — hjm
    "هجم": "hjm", "يهجم": "hjm", "هجوم": "hjm",
    "هاجم": "hjm", "مهاجم": "hjm",
    // Defend — dfʿ
    "دافع": "dfʿ", "يدافع": "dfʿ", "دفاع": "dfʿ",
    "مدافع": "dfʿ", "دفاعي": "dfʿ",
    // Conflict / Struggle — nzʿ
    "نزع": "nzʿ", "نزاع": "nzʿ", "تنازع": "nzʿ",
    "صراع": "nzʿ", "تعارض": "nzʿ",
    // Destroy / Demolish — hdm
    "يهدم": "hdm", "هدم": "hdm",
    "هادم": "hdm", "مهدوم": "hdm",
    // ── Trade / Economy — tjr ─────────────────────────────────────────────────
    "تاجر": "tjr", "يتاجر": "tjr", "تجاره": "tjr",
    "تجاري": "tjr", "تجار": "tjr",
    // Buy — šry
    "اشترى": "šry", "يشتري": "šry", "شراء": "šry",
    "مشتري": "šry",
    // Sell — byʿ
    "باع": "byʿ", "يبيع": "byʿ", "بيع": "byʿ",
    "بائع": "byʿ", "مباع": "byʿ",
    // Economy — iqtṣd
    "اقتصاد": "iqtṣd", "اقتصادي": "iqtṣd", "اقتصد": "iqtṣd",
    // Market — swq
    "سوق": "swq", "اسواق": "swq", "سوقي": "swq",
    // Price — thmn
    "ثمن": "thmn", "اثمان": "thmn", "ثمين": "thmn",
    "سعر": "thmn", "اسعار": "thmn",
    // Money / Finance — ml
    "مال": "ml", "اموال": "ml", "مالي": "ml",
    "مالكه": "ml", "تمويل": "ml",
    // Contract — ʿqd
    "عقد": "ʿqd", "يعقد": "ʿqd", "عقود": "ʿqd",
    "معاقده": "ʿqd",
    // ── Food / Eat — ʾkl ──────────────────────────────────────────────────────
    "ياكل": "ʾkl", "اكل": "ʾkl",
    "اكله": "ʾkl", "ماكول": "ʾkl", "ماكولات": "ʾkl",
    // Food — ṭʿm
    "طعام": "ṭʿm", "اطعمه": "ṭʿm", "طعمه": "ṭʿm",
    // Cook — ṭbḵ
    "طبخ": "ṭbḵ", "يطبخ": "ṭbḵ", "طباخ": "ṭbḵ",
    "مطبخ": "ṭbḵ", "مطبوخ": "ṭbḵ",
    // Meal — wjbh
    "وجبه": "wjbh", "وجبات": "wjbh",
    // Drink — šrb
    "شرب": "šrb", "يشرب": "šrb", "شراب": "šrb",
    "شارب": "šrb", "مشروب": "šrb",
    // Nutrition — ġḏy
    "غذى": "ġḏy", "يغذي": "ġḏy", "غذاء": "ġḏy",
    "تغذيه": "ġḏy", "مغذي": "ġḏy",
    // ── Health / Medicine — ṭbb ───────────────────────────────────────────────
    "طب": "ṭbb", "طبي": "ṭbb", "طبيب": "ṭbb",
    "اطباء": "ṭbb", "مستشفى": "ṭbb", "عياده": "ṭbb",
    // Heal / Cure — šfʾ
    "شفى": "šfʾ", "يشفي": "šfʾ", "شفاء": "šfʾ",
    "شافي": "šfʾ", "مشفى": "šfʾ",
    // Sick — mrḍ
    "مرض": "mrḍ", "مريض": "mrḍ", "مرضى": "mrḍ",
    "امراض": "mrḍ",
    // Treat / Therapy — ʿlj
    "علج": "ʿlj", "يعالج": "ʿlj", "علاج": "ʿlj",
    "معالج": "ʿlj", "علاجي": "ʿlj",
    // Medicine / Drug — dws
    "دواء": "dws", "ادويه": "dws", "صيدليه": "dws",
    "صيدلاني": "dws",
    // Health / Fitness — ṣḥḥ
    "صحه": "ṣḥḥ", "صحي": "ṣḥḥ", "صحيح": "ṣḥḥ",
    "اصح": "ṣḥḥ",
    // Surgery — jrḥ
    "جراح": "jrḥ", "جراحه": "jrḥ", "عمليه": "jrḥ",
    "مستشفي": "jrḥ",
    // ── Fix / Repair — ṣlḥ ────────────────────────────────────────────────────
    "اصلح": "ṣlḥ", "يصلح": "ṣlḥ", "اصلاح": "ṣlḥ",
    "صالح": "ṣlḥ", "مصلوح": "ṣlḥ", "اصلاحات": "ṣlḥ",
    // Repair — rkmm
    "رمم": "rkmm", "يرمم": "rkmm", "ترميم": "rkmm",
    "مرمم": "rkmm",
    // Update — ḥdṯ (update sense)
    "تحديث": "ḥdṯu",
    // Correct — ṣḥḥ (different from health ṣḥḥ — same root, same field "fix")
    "صحح": "ṣḥḥc", "يصحح": "ṣḥḥc", "تصحيح": "ṣḥḥc",
    // ── Connect / Link — rbt ──────────────────────────────────────────────────
    "ربط": "rbt", "يربط": "rbt", "رابط": "rbt",
    "مربوط": "rbt", "روابط": "rbt",
    // Connect (join) — wṣl
    "اتصل": "ʾtṣl", "يتصل": "ʾtṣl", "اتصال": "ʾtṣl",
    "متصل": "ʾtṣl", "اتصالات": "ʾtṣl",
    // Integrate — dmj
    "يدمج": "dmj", "دمج": "dmj",
    "مدمج": "dmj", "اندماج": "dmj",
    // Network — šbk
    "شبكه": "šbk", "شبكات": "šbk", "شبكي": "šbk",
    // ── Destroy / Break — dmr ─────────────────────────────────────────────────
    "دمر": "dmr", "يدمر": "dmr", "تدمير": "dmr",
    "مدمر": "dmr", "مدمره": "dmr",
    // Break — ksr
    "يكسر": "ksr", "كسر": "ksr",
    "كاسر": "ksr", "مكسور": "ksr",
    // Damage — tlf
    "اتلف": "tlf", "يتلف": "tlf", "تلف": "tlf",
    "تالف": "tlf",
    // Destroy — hdm (same as fight entry above; separate root code)
    // Eliminate — qḍy
    "قضى": "qḍy", "يقضي": "qḍy", "قضاء": "qḍy",
    "القضاء": "qḍy",
    // Delete — ḥḏf
    "حذف": "ḥḏf", "يحذف": "ḥḏf", "محذوف": "ḥḏf",
    // ── Possess / Own — mlk ───────────────────────────────────────────────────
    "ملك": "mlk", "يملك": "mlk", "ملكيه": "mlk",
    "مالك": "mlk", "مملوك": "mlk", "ممتلكات": "mlk",
    // Obtain — ḥṣl
    "حصل": "ḥṣl", "يحصل": "ḥṣl", "حصول": "ḥṣl",
    "حاصل": "ḥṣl",
    // ── Gather / Assemble — jmʿ ───────────────────────────────────────────────
    "يجمع": "jmʿ", "جمع": "jmʿ",
    "جامع": "jmʿ", "مجموع": "jmʿ", "اجتماع": "jmʿ",
    // Meet — ltqy
    "التقى": "ltqy", "يلتقي": "ltqy", "التقاء": "ltqy",
    "ملتقى": "ltqy", "لقاء": "ltqy",
    // Group / Crowd — ḥšd
    "يحشد": "ḥšd", "حشد": "ḥšd",
    "حاشد": "ḥšd",
    // ── Science / Research — ʿlm (science) ────────────────────────────────────
    "فيزياء": "fzyk", "فيزيائي": "fzyk",
    "كيمياء": "kmy", "كيميائي": "kmy", "كيميائيه": "kmy",
    "بيولوجي": "ʾḥyʾ",
    "رياضيات": "ryḍyt", "رياضي": "ryḍyt",
    "نظريه": "nẓry", "نظريات": "nẓry",
    "تجربه": "tjrb", "تجارب": "tjrb", "تجريبي": "tjrb",
    "معادله": "ʿdl", "معادلات": "ʿdl",
    "اكتشافات": "kšf",
    "مختبر": "ḵbr", "مختبرات": "ḵbr",
    "جيولوجيا": "jyl", "جيولوجي": "jyl",
    "فلك": "flk", "فلكي": "flk", "فلكيات": "flk",
    // ── Technology — tqn ──────────────────────────────────────────────────────
    "تقنيه": "tqn", "تقني": "tqn", "تكنولوجيا": "tqn",
    "برنامج": "brmj", "برامج": "brmj", "مبرمج": "brmj",
    "برمجه": "brmj", "يبرمج": "brmj",
    "حاسوب": "ḥsb", "كمبيوتر": "ḥsb",
    "انترنت": "šbk", "ويب": "šbk",
    "تطبيق": "tṭbyq", "تطبيقات": "tṭbyq",
    "خوارزميه": "ḵwrzm", "خوارزميات": "ḵwrzm",
    "قاعدة": "ʾdb", "بيانات": "ʾdb",
    "تشفير": "tšfyr", "مشفر": "tšfyr",
    "سيبراني": "sybr",
    "اتمته": "ʾtmt", "تلقائي": "ʾtmt",
    "روبوت": "rwbt", "ذاتي": "rwbt",
    "سحابه": "sḥbh", "خادم": "sḥbh",
    // ── Art / Creative — rsmm ─────────────────────────────────────────────────
    "رسم": "rsmm", "يرسم": "rsmm", "رسام": "rsmm",
    "رسمه": "rsmm", "رسومات": "rsmm",
    // Music — mwsq
    "موسيقى": "mwsq", "موسيقي": "mwsq", "موسيقار": "mwsq",
    "اغنيه": "mwsq", "اغاني": "mwsq", "الحان": "mwsq",
    // Poetry — šʿr (different from feel šʿr — both map to their field)
    "شاعر": "šʿrp", "قصيده": "šʿrp",
    "قصائد": "šʿrp", "شعري": "šʿrp",
    // Film / Cinema — flm
    "فيلم": "flm", "افلام": "flm", "سينما": "flm",
    "مخرج": "flm", "ممثل": "flm",
    // Theater — msrḥ
    "مسرح": "msrḥ", "مسرحيه": "msrḥ", "مسرحي": "msrḥ",
    // Sculpture / Design — nqš
    "نقش": "nqš", "نحت": "nqš", "نحات": "nqš",
    "تماثيل": "nqš", "تمثال": "nqš",
    // Photography — tṣwr
    "تصوير": "tṣwrp", "مصور": "tṣwrp", "صوره": "tṣwrp",
    "صور": "tṣwrp",
    // ── Sport / Athletics — ryḍ ───────────────────────────────────────────────
    "رياضه": "ryḍ", "رياضيون": "ryḍ",
    // Ball games — kry
    "كرات": "kry",
    // Competition — sbq
    "سباق": "sbq", "تسابق": "sbq", "متسابق": "sbq",
    "مسابقه": "sbq",
    // Champion — bṭl
    "بطل": "bṭl", "بطوله": "bṭl", "ابطال": "bṭl",
    "بطولات": "bṭl",
    // Play — lʿb
    "لعب": "lʿb", "يلعب": "lʿb", "لاعب": "lʿb",
    "لعبه": "lʿb", "ملعب": "lʿb",
    // Train — tdrb
    "تدرب": "tdrb", "يتدرب": "tdrb", "تدريب": "tdrb",
    "مدرب": "tdrb",
    // ── Nature / Environment — ṭbyʿ ───────────────────────────────────────────
    "طبيعه": "ṭbyʿ", "طبيعي": "ṭbyʿ",
    // Environment — byʾ
    "بيئه": "byʾ", "بيئي": "byʾ", "محيط": "byʾ",
    // Forest / Jungle
    "غابات": "ġbh", "غابه": "ġbh",
    // Mountain — jbl
    "جبل": "jbl", "جبال": "jbl", "جبلي": "jbl",
    // Sea / Ocean — bḥr
    "بحر": "bḥr", "بحار": "bḥr",
    // River — nhr
    "نهر": "nhr", "انهار": "nhr",
    // Desert — ṣḥrʾ
    "صحراء": "ṣḥrʾ", "صحراوي": "ṣḥrʾ",
    // Climate — mnḵ
    "مناخ": "mnḵ", "مناخي": "mnḵ",
    // Ecosystem — byʾ
    // ── Weather — ṭqs ─────────────────────────────────────────────────────────
    "طقس": "ṭqs",
    // Rain — mṭr
    "مطر": "mṭr", "امطار": "mṭr", "ممطر": "mṭr",
    "يمطر": "mṭr",
    // Snow — ṯlj
    "ثلج": "ṯlj", "ثلوج": "ṯlj", "مثلج": "ṯlj",
    // Wind — ryḥ
    "ريح": "ryḥ", "رياح": "ryḥ", "عاصفه": "ryḥ",
    // Temperature — ḥrrh
    "حراره": "ḥrrh", "برودة": "ḥrrh",
    // Sunny — šms
    "شمس": "šms", "مشمس": "šms", "اشعه": "šms",
    // Clouds — ġym
    "غيوم": "ġym", "سحاب": "ġym", "غائم": "ġym",
    // ── Measure / Calculate — ḥsb ─────────────────────────────────────────────
    "حسب": "ḥsb", "يحسب": "ḥsb", "حساب": "ḥsb",
    "محاسبه": "ḥsb",
    // Measure — qys
    "قاس": "qys", "يقيس": "qys", "قياس": "qys",
    "مقياس": "qys",
    // Count — ʿdd
    "عد": "ʿdd", "يعد": "ʿdd", "عدد": "ʿdd",
    "عداد": "ʿdd", "احصاء": "ʿdd",
    // Convert — ḥwl
    "حول": "ḥwl", "يحول": "ḥwl", "تحويل": "ḥwl",
    // Weight — wzn
    "وزن": "wzn", "يزن": "wzn", "موزون": "wzn",
    // Length / Distance — msft
    "مسافه": "msft", "بعد": "msft", "طول": "msft",
    "عرض": "msft",
};
// ── 4. Root → semantic field ─────────────────────────────────────────────────
const ROOT_FIELD = {
    // Write
    ktb: "write", sjl: "write", "ṭbʿ": "write", "ʾnšʾ": "write",
    // Know
    "ʿlm": "know", "ʿrf": "know", "qrʾ": "know", fhm: "know",
    drss: "know", "bḥṯ": "know", kšf: "know", tʿlm: "know",
    // Speak
    qwl: "speak", tkl: "speak", "ḥdṯ": "speak", šrḥ: "speak",
    "ʾʿln": "speak", "sʾl": "speak", "ḵṭb": "speak", jb: "speak",
    // Send
    rsl: "send", wṣl: "send", "bṯṯ": "send",
    // Move
    "ḥrk": "move", "ḏhb": "move", "jʾ": "move", mšy: "move",
    sfr: "move", "rḍ": "move", "ḥml": "move", ntql: "move",
    hjr: "move",
    // Create
    "ṣnʿ": "create", bny: "create", "ḵlq": "create", "ḵtrʿ": "create",
    "ṣmm": "create", ntj: "create", "ṭwr": "create",
    // Work
    "ʿml": "work", šġl: "work", "ʾdr": "work", qwd: "work",
    // Give
    "ʿṭy": "give", qddm: "give", mnḥ: "give", hdy: "give",
    tbrrʿ: "give", šrk: "give",
    // Hold
    "ḥfẓ": "hold", mssk: "hold", "ḵzn": "hold", "ʾḵḏ": "hold",
    "ḥmy": "hold",
    // Think
    fkr: "think", "ḵṭṭ": "think", "ʿtqd": "think", "ḥll": "think",
    mnṭq: "think", tṣwr: "think",
    // See
    "rʾy": "see", nẓr: "see", šhd: "see", "lḥẓ": "see",
    // Feel
    "šʿr": "feel", "ḥss": "feel", "ḥbb": "feel", "ḵwf": "feel",
    aml: "feel", "ʾrd": "feel", rġb: "feel", tmny: "feel",
    krh: "feel",
    // Exist
    kwn: "exist", wjd: "exist", "ʿyš": "exist", ẓhr: "exist",
    "ṣbḥ": "exist",
    // Govern
    "ḥkm": "govern", slṭ: "govern", syst: "govern", qnn: "govern",
    // Fight
    "ḥrb": "fight", qtl: "fight", hjm: "fight", dfʿ: "fight",
    nzʿ: "fight", hdm: "fight",
    // Trade
    tjr: "trade", šry: "trade", "byʿ": "trade", iqtṣd: "trade",
    swq: "trade", thmn: "trade", ml: "trade", "ʿqd": "trade",
    // Food
    "ʾkl": "food", "ṭʿm": "food", "ṭbḵ": "food", wjbh: "food",
    šrb: "food", "ġḏy": "food",
    // Health
    "ṭbb": "health", "šfʾ": "health", "mrḍ": "health", "ʿlj": "health",
    dws: "health", "ṣḥḥ": "health", jrḥ: "health",
    // Fix
    "ṣlḥ": "fix", rkmm: "fix", "ḥdṯu": "fix", "ṣḥḥc": "fix",
    // Connect
    rbt: "connect", "ʾtṣl": "connect", dmj: "connect", šbk: "connect",
    // Destroy
    dmr: "destroy", ksr: "destroy", tlf: "destroy",
    "qḍy": "destroy", "ḥḏf": "destroy",
    // Possess
    mlk: "possess", "ḥṣl": "possess",
    // Gather
    "jmʿ": "gather", ltqy: "gather", "ḥšd": "gather",
    // Science
    fzyk: "science", kmy: "science", "ʾḥyʾ": "science", ryḍyt: "science",
    nẓry: "science", tjrb: "science", "ḵbr": "science", jyl: "science",
    flk: "science",
    // Tech
    tqn: "tech", brmj: "tech", tṭbyq: "tech", "ḵwrzm": "tech",
    "ʾdb": "tech", "ḏkyʾ": "tech", tšfyr: "tech", sybr: "tech",
    "ʾtmt": "tech", rwbt: "tech", sḥbh: "tech",
    // Art
    rsmm: "art", mwsq: "art", "šʿrp": "art", flm: "art",
    msrḥ: "art", nqš: "art", tṣwrp: "art",
    // Sport
    ryḍ: "sport", kry: "sport", sbq: "sport", bṭl: "sport",
    "lʿb": "sport", tdrb: "sport",
    // Nature
    "ṭbyʿ": "nature", byʾ: "nature", "ġbh": "nature", jbl: "nature",
    "bḥr": "nature", nhr: "nature", "ṣḥrʾ": "nature", mnḵ: "nature",
    // Weather
    "ṭqs": "weather", "mṭr": "weather", "ṯlj": "weather", ryḥ: "weather",
    "ḥrrh": "weather", šms: "weather", "ġym": "weather",
    // Measure
    "ḥsb": "measure", qys: "measure", "ʿdd": "measure", "ḥwl": "measure",
    wzn: "measure", msft: "measure",
};
// ── 5a. Direct vocabulary — Arabic words with no derivational pattern ─────────
// Maps normalized Arabic word (post-segment) → semantic field directly.
// Covers animals, colors, body parts, specific foods, materials, places, etc.
const DIRECT_FIELD = {
    // ── Animals ──────────────────────────────────────────────────────────────
    "كلب": "animal", "قطه": "animal", "اسد": "animal",
    "نمر": "animal", "فيل": "animal", "حصان": "animal",
    "بقره": "animal", "جمل": "animal", "طير": "animal",
    "سمكه": "animal", "ثعلب": "animal", "ذئب": "animal",
    "ارنب": "animal", "دب": "animal", "قرد": "animal",
    "حيوان": "animal", "حيوانات": "animal",
    "حشره": "animal", "نحله": "animal", "فراشه": "animal",
    "طيور": "animal", "اسماك": "animal",
    "غزال": "animal", "زرافه": "animal", "تمساح": "animal",
    "ثعبان": "animal", "ضفدع": "animal", "عقرب": "animal",
    // ── Plants ───────────────────────────────────────────────────────────────
    "شجره": "plant", "اشجار": "plant", "زهره": "plant",
    "ازهار": "plant", "عشب": "plant", "نبات": "plant",
    "نباتات": "plant", "ثمره": "plant", "فاكهه": "plant",
    "ورود": "plant", "ورق": "plant", "جذر": "plant",
    "غابه": "plant", "بذره": "plant", "ساق": "plant",
    "صبار": "plant", "نخل": "plant", "قمح": "plant",
    "شجيره": "plant",
    // ── Body parts ────────────────────────────────────────────────────────────
    "يد": "body", "يدين": "body", "رجل": "body",
    "قدم": "body", "راس": "body", "وجه": "body",
    "عين": "body", "اعين": "body", "اذن": "body",
    "انف": "body", "فم": "body", "اسنان": "body",
    "لسان": "body", "رقبه": "body", "كتف": "body",
    "ذراع": "body", "صدر": "body", "بطن": "body",
    "ظهر": "body", "قلب": "body", "دماغ": "body",
    "كبد": "body", "رئه": "body", "دم": "body",
    "عظمه": "body", "جلد": "body", "عضله": "body",
    "عصب": "body", "شريان": "body", "جسم": "body",
    "جسد": "body", "ركبه": "body",
    // ── Colors ────────────────────────────────────────────────────────────────
    "احمر": "color", "ازرق": "color", "اخضر": "color",
    "اصفر": "color", "ابيض": "color", "اسود": "color",
    "برتقالي": "color", "بنفسجي": "color", "بني": "color",
    "رمادي": "color", "ذهبي": "color", "فضي": "color",
    "وردي": "color", "زيتوني": "color", "كحلي": "color",
    "لون": "color", "الوان": "color",
    // ── Materials ─────────────────────────────────────────────────────────────
    "خشب": "material", "حديد": "material", "صلب": "material",
    "زجاج": "material", "قماش": "material", "خيش": "material",
    "حجر": "material", "رخام": "material", "نحاس": "material",
    "ذهب": "material", "فضه": "material", "قطن": "material",
    "حرير": "material", "صوف": "material", "بلاستيك": "material",
    "ورق_ورق": "material", "كرتون": "material", "اسمنت": "material",
    "طين": "material", "رمل": "material",
    // ── Foods (specific) ─────────────────────────────────────────────────────
    "خبز": "food", "ارز": "food", "لحم": "food",
    "دجاج": "food", "سمك": "food", "جبن": "food",
    "بيض": "food", "حليب": "food", "زيت": "food",
    "ملح": "food", "سكر": "food", "دقيق": "food",
    "تمر": "food", "تفاح": "food", "موز": "food",
    "برتقال": "food", "طماطم": "food", "بصل": "food",
    "ثوم": "food", "فلفل": "food", "بازلاء": "food",
    "عدس": "food", "حمص": "food", "شاي": "food",
    "قهوه": "food", "مياه": "food", "عصير": "food",
    "حلوى": "food", "كعك": "food",
    // ── Time ─────────────────────────────────────────────────────────────────
    "وقت": "time", "زمن": "time", "يوم": "time",
    "ايام": "time", "ليله": "time", "صباح": "time",
    "مساء": "time", "ظهيره": "time", "اسبوع": "time",
    "اسابيع": "time", "شهر": "time", "اشهر": "time",
    "سنه": "time", "سنوات": "time", "ساعه": "time",
    "دقيقه": "time", "ثانيه": "time", "تاريخ": "time",
    "موعد": "time", "مواعيد": "time", "جدول": "time",
    "الاحد": "time", "الاثنين": "time", "الثلاثاء": "time",
    "الاربعاء": "time", "الخميس": "time", "الجمعه": "time",
    "السبت": "time", "رمضان": "time", "عيد": "time",
    // ── Place ─────────────────────────────────────────────────────────────────
    "مكان": "place", "اماكن": "place", "مدينه": "place",
    "مدن": "place", "بلد": "place", "بلدان": "place",
    "شارع": "place", "شوارع": "place", "مطار": "place",
    "محطه": "place", "فندق": "place", "مطعم": "place",
    "مستشفى": "place", "مدرسه": "place", "جامعه": "place",
    "مسجد": "place", "كنيسه": "place", "سوق": "place",
    "ميدان": "place", "مركز": "place", "قريه": "place",
    "حي": "place", "منطقه": "place", "عاصمه": "place",
    "قاره": "place", "جزيره": "place", "ساحل": "place",
    // ── Social / People ────────────────────────────────────────────────────────
    "انسان": "social", "شخص": "social", "ناس": "social",
    "مجتمع": "social", "اسره": "social", "عائله": "social",
    "صديق": "social", "اصدقاء": "social", "جار": "social",
    "طفل": "social", "شيخ": "social", "مراه": "social",
    "شباب": "social", "مواطن": "social", "شعب": "social",
    "جيل": "social", "تعاون": "social",
    // ── Quality / State ───────────────────────────────────────────────────────
    "جيد": "quality", "ممتاز": "quality", "رديء": "quality",
    "جميل": "quality", "قبيح": "quality", "كبير": "quality",
    "صغير": "quality", "طويل": "quality", "قصير": "quality",
    "سريع": "quality", "بطيء": "quality", "قوي": "quality",
    "ضعيف": "quality", "ذكي": "quality", "صعب": "quality",
    "سهل": "quality", "مختلف": "quality", "مشابه": "quality",
    "مهم": "quality", "ضروري": "quality", "جديد": "quality",
    "قديم": "quality", "اصلي": "quality", "نفس": "quality",
    // ── Measure units ─────────────────────────────────────────────────────────
    "كيلومتر": "measure", "متر": "measure", "سنتيمتر": "measure",
    "كيلوجرام": "measure", "جرام": "measure", "طن": "measure",
    "درجه": "measure", "نسبه": "measure", "مئه": "measure",
    "الف": "measure", "مليون": "measure", "مليار": "measure",
    "نصف": "measure", "ثلث": "measure", "ربع": "measure",
    "مساحه": "measure", "حجم": "measure",
    // ── Sport specifics ───────────────────────────────────────────────────────
    "تنس": "sport", "سباحه": "sport", "جري": "sport",
    "ملاكمه": "sport", "غوص": "sport", "تسلق": "sport",
    "فريق": "sport", "لاعبون": "sport", "مباراه": "sport",
    "ملعب": "sport", "هدف": "sport", "نتيجه": "sport",
    // ── Science specifics ─────────────────────────────────────────────────────
    "ذره": "science", "جزيء": "science", "نواه": "science",
    "دنا": "science", "مورثات": "science", "خليه": "science",
    "طاقه": "science", "جاذبيه": "science", "كهرباء": "science",
    "مغناطيس": "science", "ضوء": "science", "موجه": "science",
    "اشعه": "science", "فضاء": "science", "كوكب": "science",
    "نجم": "science", "مجره": "science", "كون": "science",
    // ── Tech specifics ────────────────────────────────────────────────────────
    "هاتف": "tech", "حاسب": "tech",
    "شاشه": "tech", "كاميرا": "tech", "طابعه": "tech",
    "ذاكره": "tech", "معالج": "tech", "بطاريه": "tech",
    "شاحن": "tech", "بلوتوث": "tech",
};
// ── 5b. Pre-normalized lookup tables ────────────────────────────────────────
// Build at module-init so tokenizeAr() does a single O(1) lookup per stem.
// Covers ى→ي, آ/أ/إ→ا, ؤ→و normalization mismatches automatically.
const _ROOT_MAP_NORM = {};
for (const [k, v] of Object.entries(ROOT_MAP)) {
    if (k.includes(" "))
        continue; // skip multi-word (→ COMPOUND_FIELDS_AR)
    _ROOT_MAP_NORM[normalize(k)] = v;
    _ROOT_MAP_NORM[normalize(segment(k))] = v;
}
const _DIRECT_FIELD_NORM = {};
for (const [k, v] of Object.entries(DIRECT_FIELD)) {
    if (k.includes(" "))
        continue;
    _DIRECT_FIELD_NORM[normalize(k)] = v;
    _DIRECT_FIELD_NORM[normalize(segment(k))] = v;
}
// ── 5c. Compound Arabic phrases (bigram pre-scan, like English COMPOUND_FIELDS)
exports.COMPOUND_FIELDS_AR = {
    // Technology / AI
    "ذكاء اصطناعي": "tech",
    "تعلم الة": "know",
    "تعلم آلي": "know",
    "شبكه عصبيه": "tech",
    "معالجه لغه": "speak",
    "واجهه مستخدم": "tech",
    "قاعده بيانات": "tech",
    "امن معلومات": "tech",
    "امن سيبراني": "tech",
    "حوسبه سحابيه": "tech",
    "تعلم عميق": "know",
    "واي فاي": "tech",
    "بلوتوث اله": "tech",
    "لوحه مفاتيح": "tech",
    // Health
    "صحه نفسيه": "health",
    "ضغط دم": "health",
    "سكر دم": "health",
    "اشعه سينيه": "health",
    "علاج طبيعي": "health",
    "اسعاف اولي": "health",
    "عمليه جراحيه": "health",
    // Science
    "تغيير مناخي": "weather",
    "تغير مناخ": "weather",
    "احتباس حراري": "weather",
    "نظام شمسي": "science",
    "ثقب اسود": "science",
    "نظريه كم": "science",
    "نظام بيئي": "nature",
    "احوال جويه": "weather",
    "درجه حراره": "weather",
    // Sport
    "كره قدم": "sport",
    "كره سله": "sport",
    "كره طائره": "sport",
    "كره يد": "sport",
    "العاب قوى": "sport",
    "سباق سيارات": "sport",
    "كاس عالم": "sport",
    // Social / Media
    "وسائل تواصل": "send",
    "تواصل اجتماعي": "send",
    "وسائل اعلام": "send",
    // Economy / Trade
    "سوق مال": "trade",
    "سعر صرف": "trade",
    "فائده مركبه": "trade",
    // Time
    "وقت حقيقي": "time",
    "منطقه زمنيه": "time",
    // Fight / Conflict
    "حرب اهليه": "fight",
};
const STRUCTURAL_MAP_AR = {
    // Negation
    "لا": "NEG",
    "لم": "NEG",
    "لن": "NEG",
    "ما": "NEG",
    "ليس": "NEG",
    "مش": "NEG", // colloquial (Egyptian/Levantine)
    "مو": "NEG", // colloquial (Gulf)
    "غير": "NEG", // non- / un-
    // Questions
    "هل": "QUERY",
    "ا": "QUERY", // أ question prefix (rare)
    "ماذا": "WHAT_Q",
    "من": "WHO_Q",
    "اي": "WHICH_Q",
    "اين": "WHERE_Q",
    "متى": "WHEN_Q",
    "لماذا": "WHY_Q",
    "كيف": "HOW_Q",
    "كم": "WHAT_Q",
    // Condition
    "اذا": "COND",
    "لو": "COND",
    "ان": "COND", // إن conditional
    // Cause
    "لان": "CAUSE",
    "بسبب": "CAUSE",
    "لذلك": "CAUSE",
    "لذا": "CAUSE",
    "نتيجه": "CAUSE",
    // Future
    "سوف": "FUTURE",
    "ستكون": "FUTURE",
    // Past
    "كان": "PAST",
    "كانت": "PAST",
    "كانوا": "PAST",
    "كنت": "PAST",
    // Modal — ability
    "يمكن": "MODAL",
    "يستطيع": "MODAL",
    "قادر": "MODAL",
    "يقدر": "MODAL",
    "قدره": "MODAL",
    // Modal — obligation
    "يجب": "MODAL",
    "ينبغي": "MODAL",
    "لازم": "MODAL",
    "ضروري": "MODAL",
    "واجب": "MODAL",
    // Modal — possibility
    "ربما": "MODAL",
    "لعل": "MODAL",
    "عسى": "MODAL",
    "احتمال": "MODAL",
    "ممكن": "MODAL",
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
const RELATION_MAP_AR = {
    "الى": "REL:to",
    "نحو": "REL:to",
    "من": "REL:from",
    "مع": "REL:with",
    "بدون": "REL:without",
    "في": "REL:in",
    "على": "REL:on",
    "تحت": "REL:under",
    "فوق": "REL:above",
    "عن": "REL:about",
    "بين": "REL:between",
    "خارج": "REL:outside",
    "داخل": "REL:in",
    "و": "REL:and",
    "او": "REL:or",
    "لكن": "REL:but",
    "قبل": "REL:before",
    "بعد": "REL:after",
    "خلال": "REL:during",
    "منذ": "REL:since",
    "حتى": "REL:until",
    "بسبب": "REL:causes",
    "ضد": "REL:against",
    "حول": "REL:about",
    "وراء": "REL:behind",
    "امام": "REL:before",
    "بجانب": "REL:beside",
    "عبر": "REL:via",
    "لكل": "REL:for",
    "حسب": "REL:per",
};
// ── 7b. Pre-normalized STRUCTURAL and RELATION lookups ──────────────────────
// Built after map definitions so normalize() mismatches (ى→ي, إ→ا, etc.) are
// handled automatically at lookup time.
const _STRUCTURAL_NORM = {};
for (const [k, v] of Object.entries(STRUCTURAL_MAP_AR)) {
    _STRUCTURAL_NORM[normalize(k)] = v;
}
const _RELATION_NORM = {};
for (const [k, v] of Object.entries(RELATION_MAP_AR)) {
    _RELATION_NORM[normalize(k)] = v;
}
// ── 7c. Pre-normalized FUNCTION_WORDS set ────────────────────────────────────
const _FUNCTION_WORDS_NORM = new Set();
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
const ALEF = "\u0627"; // ا
const MIM = "\u0645"; // م
const TA = "\u062A"; // ت
const WAW = "\u0648"; // و
const YEH = "\u064A"; // ي
const HAR = "\u0647"; // ه (role detection)
function detectRoleAr(stem) {
    const n = stem.length;
    if (n < 3)
        return undefined;
    // فاعل pattern (agent): C ا C C  → len 4, index 1 is ا
    if (n === 4 && stem[1] === ALEF)
        return "agent";
    // فاعله pattern (agent fem): C ا C C ه → len 5, [1]==ا, ends ه
    if (n === 5 && stem[1] === ALEF && stem[4] === HAR)
        return "agent";
    // مفعول pattern (patient): م C C و C → len 5, [0]==م, [3]==و
    if (n === 5 && stem[0] === MIM && stem[3] === WAW)
        return "patient";
    // مفعوله (patient fem): م C C و C ه → len 6, [0]==م, [3]==و, ends ه
    if (n === 6 && stem[0] === MIM && stem[3] === WAW && stem[5] === HAR)
        return "patient";
    // تفعيل pattern (process/instance): ت C C ي C → len 5, [0]==ت, [3]==ي
    if (n === 5 && stem[0] === TA && stem[3] === YEH)
        return "process";
    // مفعله pattern (place): م ... ه, len 5-6, [0]==م, ends ه
    if ((n === 5 || n === 6) && stem[0] === MIM && stem[n - 1] === HAR &&
        stem[3] !== WAW)
        return "place";
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
function tokenizeAr(sentence) {
    const tokens = [];
    const norm = normalize(sentence.replace(/[؟!.،]+$/, ""));
    const words = norm.split(/\s+/);
    if (sentence.trimEnd().endsWith("?") || sentence.trimEnd().endsWith("؟")) {
        tokens.push({ type: "QUERY", value: "QUERY", surface: "؟" });
    }
    // ── Compound bigram pre-scan (mirrors English COMPOUND_FIELDS logic) ────────
    const skipIdx = new Set();
    for (let i = 0; i < words.length - 1; i++) {
        const w0 = words[i];
        const w1 = words[i + 1];
        if (!w0 || !w1)
            continue;
        const pairs = [
            `${w0} ${w1}`,
            `${segment(w0)} ${w1}`,
            `${w0} ${segment(w1)}`,
            `${segment(w0)} ${segment(w1)}`,
        ];
        let compoundField;
        for (const pair of pairs) {
            if (exports.COMPOUND_FIELDS_AR[pair]) {
                compoundField = exports.COMPOUND_FIELDS_AR[pair];
                break;
            }
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
        if (skipIdx.has(idx))
            continue;
        const rawWord = words[idx];
        const word = rawWord.trim();
        if (!word)
            continue;
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
        if (_FUNCTION_WORDS_NORM.has(word))
            continue;
        // Sīn future prefix (سـ): سيكتب → FUTURE + rest as concept
        const SA_PREFIX = "\u0633"; // س
        if (word.startsWith(SA_PREFIX) && word.length > 2 && word !== "سوف") {
            tokens.push({ type: "FUTURE", value: "FUTURE", surface: word[0] });
            const rest = word.slice(1);
            const rstem = segment(rest);
            const rroot = _ROOT_MAP_NORM[rstem] ?? _ROOT_MAP_NORM[rest];
            const rfield = rroot
                ? ROOT_FIELD[rroot]
                : (_DIRECT_FIELD_NORM[rstem] ?? _DIRECT_FIELD_NORM[rest]);
            if (rfield) {
                tokens.push({ type: "CONCEPT", value: `CONCEPT:${rfield}`, surface: word, field: rfield });
                const rrole = detectRoleAr(rstem);
                if (rrole)
                    tokens.push({ type: "ROLE", value: `ROLE:${rrole}`, surface: word, role: rrole });
            }
            else {
                tokens.push({ type: "LIT", value: `LIT:${word}`, surface: word });
            }
            continue;
        }
        // Main path: segment → normalized root/direct lookup → CONCEPT (+ optional ROLE)
        // Uses _ROOT_MAP_NORM / _DIRECT_FIELD_NORM built at module init to handle
        // normalization variants (ى→ي, آ/أ→ا, etc.) automatically.
        const stem = segment(word);
        const root = _ROOT_MAP_NORM[stem] ?? _ROOT_MAP_NORM[word];
        const field = root
            ? ROOT_FIELD[root]
            : (_DIRECT_FIELD_NORM[stem] ?? _DIRECT_FIELD_NORM[word]);
        // Check role on both the stem AND the original normalized word.
        // Necessary because segment() may strip a meaningful prefix (e.g. ك from كاتب)
        // that would otherwise be recognized by the fāʿil pattern.
        const role = detectRoleAr(stem) ?? detectRoleAr(word);
        if (field && role) {
            tokens.push({ type: "CONCEPT", value: `CONCEPT:${field}`, surface: word, field });
            tokens.push({ type: "ROLE", value: `ROLE:${role}`, surface: word, role });
        }
        else if (field) {
            tokens.push({ type: "CONCEPT", value: `CONCEPT:${field}`, surface: word, field });
        }
        else if (role) {
            // Emit ROLE even without a field — parity with English tokenizer
            tokens.push({ type: "ROLE", value: `ROLE:${role}`, surface: word, role });
        }
        else {
            tokens.push({ type: "LIT", value: `LIT:${word}`, surface: word });
        }
    }
    return tokens;
}
/** Human-readable token stream for Arabic input. */
function tokenStreamAr(sentence) {
    return tokenizeAr(sentence)
        .map((t) => t.value)
        .join(" ");
}
//# sourceMappingURL=tokenizer-ar.js.map