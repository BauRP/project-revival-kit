import { dbGet, dbPut } from "@/lib/storage";

export interface TranslationSettingsState {
  sourceLanguage: string;
  targetLanguage: string;
  autoTranslateIncoming: boolean;
}

export const TRANSLATION_SETTINGS_KEY = "translation-settings";

export const TRANSLATION_LANGUAGE_OPTIONS: Array<{ code: string; name: string }> = [
  ["af", "Afrikaans"], ["sq", "Albanian"], ["am", "Amharic"], ["ar", "Arabic"], ["hy", "Armenian"], ["az", "Azerbaijani"],
  ["eu", "Basque"], ["be", "Belarusian"], ["bn", "Bengali"], ["bs", "Bosnian"], ["bg", "Bulgarian"], ["ca", "Catalan"],
  ["ceb", "Cebuano"], ["zh", "Chinese"], ["co", "Corsican"], ["hr", "Croatian"], ["cs", "Czech"], ["da", "Danish"],
  ["nl", "Dutch"], ["en", "English"], ["eo", "Esperanto"], ["et", "Estonian"], ["fi", "Finnish"], ["fr", "French"],
  ["fy", "Frisian"], ["gl", "Galician"], ["ka", "Georgian"], ["de", "German"], ["el", "Greek"], ["gu", "Gujarati"],
  ["ht", "Haitian Creole"], ["ha", "Hausa"], ["haw", "Hawaiian"], ["he", "Hebrew"], ["hi", "Hindi"], ["hmn", "Hmong"],
  ["hu", "Hungarian"], ["is", "Icelandic"], ["ig", "Igbo"], ["id", "Indonesian"], ["ga", "Irish"], ["it", "Italian"],
  ["ja", "Japanese"], ["jv", "Javanese"], ["kn", "Kannada"], ["kk", "Kazakh"], ["km", "Khmer"], ["ko", "Korean"],
  ["ku", "Kurdish"], ["ky", "Kyrgyz"], ["lo", "Lao"], ["la", "Latin"], ["lv", "Latvian"], ["lt", "Lithuanian"],
  ["lb", "Luxembourgish"], ["mk", "Macedonian"], ["mg", "Malagasy"], ["ms", "Malay"], ["ml", "Malayalam"], ["mt", "Maltese"],
  ["mi", "Maori"], ["mr", "Marathi"], ["mn", "Mongolian"], ["my", "Myanmar"], ["ne", "Nepali"], ["no", "Norwegian"],
  ["ny", "Nyanja"], ["or", "Odia"], ["ps", "Pashto"], ["fa", "Persian"], ["pl", "Polish"], ["pt", "Portuguese"],
  ["pa", "Punjabi"], ["ro", "Romanian"], ["ru", "Russian"], ["sm", "Samoan"], ["gd", "Scots Gaelic"], ["sr", "Serbian"],
  ["st", "Sesotho"], ["sn", "Shona"], ["sd", "Sindhi"], ["si", "Sinhala"], ["sk", "Slovak"], ["sl", "Slovenian"],
  ["so", "Somali"], ["es", "Spanish"], ["su", "Sundanese"], ["sw", "Swahili"], ["sv", "Swedish"], ["tl", "Tagalog"],
  ["tg", "Tajik"], ["ta", "Tamil"], ["tt", "Tatar"], ["te", "Telugu"], ["th", "Thai"], ["tr", "Turkish"],
  ["tk", "Turkmen"], ["uk", "Ukrainian"], ["ur", "Urdu"], ["ug", "Uyghur"], ["uz", "Uzbek"], ["vi", "Vietnamese"],
  ["cy", "Welsh"], ["xh", "Xhosa"], ["yi", "Yiddish"], ["yo", "Yoruba"], ["zu", "Zulu"],
].map(([code, name]) => ({ code, name }));

const DEFAULT_SETTINGS: TranslationSettingsState = {
  sourceLanguage: "en",
  targetLanguage: "ru",
  autoTranslateIncoming: true,
};

/**
 * Bidirectional RU↔EN core dictionary. Stored as one canonical EN→RU map and
 * inverted on demand, so adding a pair only needs to happen once. Multi-word
 * RU phrases are intentionally lowercased — case preservation is applied at
 * runtime by `applyCase`, not stored here.
 */
const enToRu: Record<string, string> = {
  hello: "привет", hi: "привет", hey: "привет", goodbye: "пока", bye: "пока",
  yes: "да", no: "нет", maybe: "возможно", ok: "хорошо", okay: "хорошо",
  please: "пожалуйста", thanks: "спасибо", thank: "спасибо", sorry: "извини",
  excuse: "извините", welcome: "добро пожаловать",
  good: "хорошо", bad: "плохо", great: "отлично", awesome: "потрясающе", nice: "приятно",
  how: "как", what: "что", who: "кто", where: "где", when: "когда", why: "почему", which: "какой",
  are: "являются", is: "является", am: "являюсь", was: "был", were: "были", be: "быть", been: "был",
  do: "делать", does: "делает", did: "делал", done: "сделано",
  have: "иметь", has: "имеет", had: "имел",
  can: "могу", could: "мог", will: "буду", would: "бы", should: "следует", must: "должен",
  i: "я", you: "ты", he: "он", she: "она", it: "оно", we: "мы", they: "они",
  me: "меня", him: "его", her: "её", us: "нас", them: "их",
  my: "мой", your: "твой", his: "его", our: "наш", their: "их",
  this: "это", that: "то", these: "эти", those: "те",
  and: "и", or: "или", but: "но", if: "если", because: "потому что", so: "так",
  not: "не", very: "очень", much: "много", more: "больше", less: "меньше",
  today: "сегодня", tomorrow: "завтра", yesterday: "вчера", now: "сейчас", later: "позже",
  morning: "утро", day: "день", evening: "вечер", night: "ночь", week: "неделя", month: "месяц", year: "год",
  time: "время", hour: "час", minute: "минута", second: "секунда",
  friend: "друг", family: "семья", love: "любовь", life: "жизнь", work: "работа", home: "дом",
  house: "дом", school: "школа", city: "город", country: "страна", world: "мир", people: "люди",
  man: "мужчина", woman: "женщина", child: "ребёнок", boy: "мальчик", girl: "девочка",
  food: "еда", water: "вода", coffee: "кофе", tea: "чай", bread: "хлеб",
  message: "сообщение", call: "звонок", photo: "фото", video: "видео", chat: "чат",
  send: "отправить", sent: "отправлено", read: "прочитано", new: "новое", old: "старое",
  meeting: "встреча", project: "проект", idea: "идея", question: "вопрос", answer: "ответ",
  go: "идти", come: "приходить", see: "видеть", look: "смотреть", know: "знать", think: "думать",
  want: "хочу", need: "нужно", like: "нравится", love2: "люблю", make: "делать", get: "получить",
  give: "дать", take: "взять", say: "сказать", tell: "рассказать", ask: "спросить",
  understand: "понимать", remember: "помнить", forget: "забыть",
  big: "большой", small: "маленький", new2: "новый", old2: "старый", fast: "быстрый", slow: "медленный",
  hot: "горячий", cold: "холодный", happy: "счастливый", sad: "грустный",
  one: "один", two: "два", three: "три", four: "четыре", five: "пять",
  six: "шесть", seven: "семь", eight: "восемь", nine: "девять", ten: "десять",
  zero: "ноль", hundred: "сто", thousand: "тысяча",
  the: "", a: "", an: "",
  of: "из", in: "в", on: "на", at: "в", to: "к", from: "от", with: "с", for: "для",
  about: "о", after: "после", before: "до", between: "между", under: "под", over: "над",
  again: "снова", always: "всегда", never: "никогда", often: "часто", sometimes: "иногда",
  here: "здесь", there: "там", everywhere: "везде", nowhere: "нигде",
  please2: "пожалуйста", really: "действительно", maybe2: "возможно",
  beautiful: "красивый", interesting: "интересный", important: "важный", easy: "лёгкий", difficult: "трудный",
  problem: "проблема", solution: "решение",
  buy: "купить", sell: "продать", pay: "платить", money: "деньги", price: "цена",
  open: "открыть", close: "закрыть", start: "начать", stop: "остановить", finish: "закончить",
  help: "помощь", wait: "ждать", listen: "слушать", speak: "говорить", talk: "говорить",
  write: "писать", reading: "чтение", learn: "учиться", teach: "учить",
  feel: "чувствовать", play: "играть", win: "выиграть", lose: "проиграть",
  yes2: "да", noproblem: "без проблем",
  morning2: "утром", today2: "сегодня",
  goodmorning: "доброе утро", goodnight: "спокойной ночи",
  congratulations: "поздравляю", happybirthday: "с днём рождения",
};

/** Strip the disambiguation suffixes (e.g. "love2" → "love") used to allow
 *  multiple semantic mappings of the same English head word. */
const cleanKey = (k: string) => k.replace(/\d+$/, "");

const enToRuClean: Record<string, string> = Object.fromEntries(
  Object.entries(enToRu).map(([k, v]) => [cleanKey(k), v]),
);

const ruToEn: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [en, ru] of Object.entries(enToRu)) {
    if (!ru) continue;
    const cleanedEn = cleanKey(en);
    if (!(ru in out)) out[ru.toLowerCase()] = cleanedEn;
  }
  // Hand-tuned RU→EN overrides for common collisions.
  Object.assign(out, {
    "привет": "hello",
    "пока": "bye",
    "спасибо": "thanks",
    "пожалуйста": "please",
    "извини": "sorry",
    "извините": "sorry",
    "хорошо": "good",
    "плохо": "bad",
    "отлично": "great",
    "как": "how",
    "что": "what",
    "кто": "who",
    "где": "where",
    "когда": "when",
    "почему": "why",
    "дела": "doing",
    "у": "at",
    "тебя": "you",
    "меня": "me",
    "всё": "everything",
    "все": "all",
    "это": "this",
    "то": "that",
    "сегодня": "today",
    "завтра": "tomorrow",
    "вчера": "yesterday",
    "сейчас": "now",
    "люблю": "love",
    "хочу": "want",
    "знаю": "know",
    "думаю": "think",
    "друг": "friend",
    "мир": "world",
    "жизнь": "life",
    "работа": "work",
    "дом": "home",
    "семья": "family",
    "и": "and",
    "или": "or",
    "но": "but",
    "не": "not",
    "да": "yes",
    "нет": "no",
    "очень": "very",
    "много": "many",
    "мало": "few",
  });
  return out;
})();

export async function getTranslationSettings(): Promise<TranslationSettingsState> {
  return (await dbGet<TranslationSettingsState>("settings", TRANSLATION_SETTINGS_KEY)) || DEFAULT_SETTINGS;
}

export async function saveTranslationSettings(settings: TranslationSettingsState): Promise<void> {
  await dbPut("settings", TRANSLATION_SETTINGS_KEY, settings);
}

export function detectLanguage(text: string): string | null {
  if (!text.trim()) return null;
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[ğüşöçıİĞÜŞÖÇ]/i.test(text)) return "tr";
  if (/[A-Za-z]/.test(text)) return "en";
  return null;
}

/** Mirror the casing of `source` onto `target`, character-by-character.
 *  - ALL CAPS → upper-case the translation
 *  - Title Case (first letter cap) → upper-case the first letter only
 *  - lowercase / mixed → leave translation lowercased */
function applyCase(source: string, target: string): string {
  if (!source || !target) return target;
  const isAllUpper = source.length > 1 && source === source.toUpperCase() && source !== source.toLowerCase();
  const firstUpper = source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase();
  if (isAllUpper) return target.toUpperCase();
  if (firstUpper) return target.charAt(0).toUpperCase() + target.slice(1);
  return target.toLowerCase();
}

/**
 * Phrase dictionaries — looked up BEFORE single-word fallback so that
 * idiomatic multi-word constructions translate naturally and completely.
 * Keys MUST be lowercased; matching is whitespace-normalized and
 * case-insensitive. Casing is reapplied from the original source span.
 */
const ruToEnPhrases: Record<string, string> = {
  "что делаешь": "what are you doing",
  "что делаете": "what are you doing",
  "как дела": "how are you doing",
  "как ты": "how are you",
  "как вы": "how are you",
  "как поживаешь": "how are you",
  "у меня всё хорошо": "i am doing well",
  "у меня все хорошо": "i am doing well",
  "всё хорошо": "all is well",
  "все хорошо": "all is well",
  "доброе утро": "good morning",
  "добрый день": "good afternoon",
  "добрый вечер": "good evening",
  "спокойной ночи": "good night",
  "до свидания": "goodbye",
  "большое спасибо": "thank you very much",
  "не за что": "you are welcome",
  "пожалуйста подожди": "please wait",
  "я тебя люблю": "i love you",
  "я не знаю": "i do not know",
  "я не понимаю": "i do not understand",
  "ты понимаешь": "do you understand",
  "что нового": "what is new",
  "что случилось": "what happened",
  "сколько время": "what time is it",
  "сколько времени": "what time is it",
  "где ты": "where are you",
  "куда идёшь": "where are you going",
  "куда идешь": "where are you going",
  "с днём рождения": "happy birthday",
  "с днем рождения": "happy birthday",
};

const enToRuPhrases: Record<string, string> = {
  "what are you doing": "что ты делаешь",
  "how are you doing": "как у тебя дела",
  "how are you": "как дела",
  "i am doing well": "у меня всё хорошо",
  "good morning": "доброе утро",
  "good afternoon": "добрый день",
  "good evening": "добрый вечер",
  "good night": "спокойной ночи",
  "thank you very much": "большое спасибо",
  "thank you": "спасибо",
  "you are welcome": "не за что",
  "i love you": "я тебя люблю",
  "i do not know": "я не знаю",
  "i don't know": "я не знаю",
  "i do not understand": "я не понимаю",
  "i don't understand": "я не понимаю",
  "what happened": "что случилось",
  "what time is it": "сколько сейчас времени",
  "where are you": "где ты",
  "where are you going": "куда ты идёшь",
  "happy birthday": "с днём рождения",
  "good bye": "до свидания",
  "see you": "до встречи",
};

/**
 * Translate the FULL string. Algorithm:
 *   1. Tokenize into a stream of words and separators (whitespace/punctuation).
 *   2. Walk the word stream. At each position, attempt the LONGEST phrase
 *      match (up to 6 words) against the phrase dictionary. If hit, emit
 *      the phrase translation with casing mirrored from the source span.
 *   3. Otherwise fall back to single-word lookup, preserving casing.
 *   4. Unknown words are preserved verbatim. Punctuation, digits, emoji
 *      and URLs are kept exactly where they appeared.
 *
 * No length limit, no skipping — every token is processed.
 */
export function translateWithBundledDictionary(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): string | null {
  if (!text) return null;
  const pair = `${sourceLanguage}:${targetLanguage}`;
  let wordDict: Record<string, string> | null = null;
  let phraseDict: Record<string, string> | null = null;
  if (pair === "en:ru") { wordDict = enToRuClean; phraseDict = enToRuPhrases; }
  else if (pair === "ru:en") { wordDict = ruToEn; phraseDict = ruToEnPhrases; }
  if (!wordDict) return null;

  // Tokenize into alternating [word, sep, word, sep, ...]. Unicode-aware.
  const rawTokens = text.split(/([^\p{L}\p{N}']+)/u).filter((t) => t !== "");
  const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t);

  // Index of word positions inside rawTokens, for phrase lookahead.
  const wordIdx: number[] = [];
  rawTokens.forEach((t, i) => { if (isWord(t)) wordIdx.push(i); });

  let touched = false;
  const consumed = new Array(rawTokens.length).fill(false);
  const replacements = new Map<number, { lastIdx: number; text: string }>();

  // Phrase pass — greedy longest match.
  const MAX_PHRASE = 6;
  for (let w = 0; w < wordIdx.length; w++) {
    const startTokIdx = wordIdx[w];
    if (consumed[startTokIdx]) continue;
    let matched = false;
    for (let len = Math.min(MAX_PHRASE, wordIdx.length - w); len >= 2; len--) {
      const lastTokIdx = wordIdx[w + len - 1];
      const span = rawTokens.slice(startTokIdx, lastTokIdx + 1).join("");
      const key = span.toLowerCase().replace(/\s+/g, " ").trim();
      const hit = phraseDict ? phraseDict[key] : undefined;
      if (hit !== undefined) {
        replacements.set(startTokIdx, { lastIdx: lastTokIdx, text: applyCase(span, hit) });
        for (let k = startTokIdx; k <= lastTokIdx; k++) consumed[k] = true;
        touched = true;
        w += len - 1;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Single-word fallback handled in the emit pass.
    }
  }

  // Emit pass.
  const out: string[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i];
    const repl = replacements.get(i);
    if (repl) {
      out.push(repl.text);
      i = repl.lastIdx;
      continue;
    }
    if (consumed[i]) continue; // covered by an earlier phrase
    if (!isWord(tok)) { out.push(tok); continue; }
    const hit = wordDict![tok.toLowerCase()];
    if (hit === undefined) { out.push(tok); continue; }
    if (hit === "") { touched = true; continue; }
    touched = true;
    out.push(applyCase(tok, hit));
  }

  const joined = out.join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  if (!touched) return null;
  return joined;
}

export function getLanguageName(code: string): string {
  return TRANSLATION_LANGUAGE_OPTIONS.find((item) => item.code === code)?.name || code;
}
