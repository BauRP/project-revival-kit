/**
 * Trivo Support — offline NLP engine (NLP.js).
 *
 * 100% client-side. There is not a single network call in this module: the
 * neural intent classifier is trained on-device from the bundled knowledge
 * base (`support-data.ts`) at first use and then answers locally. This keeps
 * the Zero-Trust guarantee intact — the assistant works with the radio off.
 *
 * The module is deliberately environment-agnostic so it can run inside a Web
 * Worker (preferred, keeps the UI thread free) or, as a last resort, on the
 * main thread.
 */
import { containerBootstrap } from "@nlpjs/core";
import { Nlp } from "@nlpjs/nlp";
import { LangRu } from "@nlpjs/lang-ru";
import { LangEn } from "@nlpjs/lang-en";
import { botKnowledgeBase, type SupportIntent } from "./support-data";

export type BotLang = "ru" | "en";

/** Minimum neural confidence required to trust a classification. */
const NLP_CONFIDENCE_THRESHOLD = 0.55;

const intentById = new Map<string, SupportIntent>(
  botKnowledgeBase.map((intent) => [intent.id, intent]),
);

/** Slash commands resolve deterministically, bypassing the classifier. */
const commandIndex = (() => {
  const map = new Map<string, string>();
  for (const intent of botKnowledgeBase) {
    for (const keyword of intent.keywords) {
      if (keyword.startsWith("/")) map.set(keyword.toLowerCase(), intent.id);
    }
  }
  return map;
})();

const CYRILLIC = /[\u0400-\u04FF]/;

export function detectLanguage(text: string): BotLang {
  return CYRILLIC.test(text) ? "ru" : "en";
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ *
 * Lexical fallback (Levenshtein) — used when the classifier is not
 * confident enough, or if NLP.js failed to initialise on this device.
 * ------------------------------------------------------------------ */

function levenshtein(a: string, b: string): number {
  const rows = b.length + 1;
  const cols = a.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) matrix[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function lexicalMatch(cleanMessage: string): { id: string; score: number } | null {
  const words = cleanMessage.split(/\s+/).filter(Boolean);
  let bestId: string | null = null;
  let bestScore = 0;

  for (const intent of botKnowledgeBase) {
    let score = 0;
    for (const rawKeyword of intent.keywords) {
      const keyword = rawKeyword.toLowerCase();
      if (keyword.startsWith("/")) continue;
      if (cleanMessage.includes(keyword)) {
        score += 10;
        continue;
      }
      for (const word of words) {
        if (word.length < 3) continue;
        if (keyword.includes(word) || word.includes(keyword)) {
          score += 3;
          continue;
        }
        const allowedTypos = keyword.length > 5 ? 2 : 1;
        if (levenshtein(word, keyword) <= allowedTypos) score += 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = intent.id;
    }
  }

  return bestId && bestScore >= 2 ? { id: bestId, score: bestScore } : null;
}

/* ------------------------------------------------------------------ *
 * Neural engine
 * ------------------------------------------------------------------ */

let nlpPromise: Promise<Nlp> | null = null;

async function buildNlp(): Promise<Nlp> {
  const container = await containerBootstrap();
  container.use(Nlp);
  container.use(LangRu);
  container.use(LangEn);

  const nlp = container.get<Nlp>("nlp");
  nlp.settings.autoSave = false;
  nlp.settings.autoLoad = false;
  nlp.settings.modelFileName = undefined;
  nlp.settings.threshold = 0;
  nlp.addLanguage(["ru", "en"]);

  for (const intent of botKnowledgeBase) {
    for (const keyword of intent.keywords) {
      const utterance = keyword.startsWith("/") ? keyword.slice(1) : keyword;
      if (!utterance.trim()) continue;
      const locale = detectLanguage(utterance);
      nlp.addDocument(locale, utterance, intent.id);
      // Cross-train the opposite locale so mixed-language input still lands
      // on the right intent (the corpus is bilingual by design).
      nlp.addDocument(locale === "ru" ? "en" : "ru", utterance, intent.id);
    }
    nlp.addAnswer("ru", intent.id, intent.replyRu);
    nlp.addAnswer("en", intent.id, intent.replyEn);
  }

  await nlp.train();
  return nlp;
}

/** Trains (once) and caches the on-device model. */
export function warmup(): Promise<Nlp> {
  if (!nlpPromise) {
    nlpPromise = buildNlp().catch((err) => {
      nlpPromise = null;
      throw err;
    });
  }
  return nlpPromise;
}

function answerFor(intentId: string, lang: BotLang): string | null {
  const intent = intentById.get(intentId);
  if (!intent) return null;
  return lang === "ru" ? intent.replyRu : intent.replyEn;
}

function greeting(lang: BotLang): string {
  return lang === "ru"
    ? "🤖 Приветствую! Я системный ассистент Trivo. Напишите ваш вопрос или отправьте /help для списка команд."
    : "🤖 Greetings! I am the Trivo system assistant. Type your question or send /help for commands.";
}

function fallback(lang: BotLang): string {
  return lang === "ru"
    ? "К сожалению, я не нашел точного ответа. 😔\n\n💡 **Попробуйте спросить иначе или используйте команды:**\n/help — Главное меню\n/security — О шифровании\n/tor — Статус сети\n/friends — Как искать контакты"
    : "I couldn't find an exact answer. 😔\n\n💡 **Try rephrasing or use commands:**\n/help — Main Menu\n/security — About Encryption\n/tor — Network Status\n/friends — Finding Contacts";
}

/**
 * Resolves a reply fully offline. Order of resolution:
 *   1. exact slash command
 *   2. NLP.js neural classifier (>= 0.55 confidence)
 *   3. lexical / typo-tolerant fallback
 *   4. menu fallback
 */
export async function resolveReply(userMessage: string, requestedLang?: BotLang): Promise<string> {
  const raw = (userMessage || "").trim();
  const lang = requestedLang || detectLanguage(raw);
  const clean = normalize(raw);

  if (!raw) return greeting(lang);

  const command = commandIndex.get(raw.toLowerCase().split(/\s+/)[0]);
  if (command) return answerFor(command, lang) || fallback(lang);

  try {
    const nlp = await warmup();
    const result = await nlp.process(lang, raw);
    if (
      result &&
      result.intent &&
      result.intent !== "None" &&
      result.score >= NLP_CONFIDENCE_THRESHOLD
    ) {
      const answer = answerFor(result.intent, lang);
      if (answer) return answer;
    }
  } catch (err) {
    console.warn("[support-nlp] classifier unavailable, using lexical match", err);
  }

  const lexical = lexicalMatch(clean);
  if (lexical) return answerFor(lexical.id, lang) || fallback(lang);

  return fallback(lang);
}
