const LANG_NAMES: Record<string, string> = {
  en: "English",
  ru: "Russian",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  tr: "Turkish",
  hi: "Hindi",
  uk: "Ukrainian",
  pl: "Polish",
};

export interface TranslateTextInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export type TranslateTextResult =
  | { ok: true; translated: string }
  | { ok: false; error: string };

const langName = (code: string) => LANG_NAMES[code] || code;

/**
 * LLM-backed translation via Lovable AI Gateway. Context-aware (preserves
 * tone, slang, jargon, casing, punctuation).
 */
export async function translateTextServer(data: TranslateTextInput): Promise<TranslateTextResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "LOVABLE_API_KEY is not configured" };
  }

  const src = langName(data.sourceLanguage);
  const tgt = langName(data.targetLanguage);
  const systemPrompt = `You are a professional ${src}→${tgt} translator. Translate the user's message faithfully and naturally, preserving tone, intent, slang, jargon, punctuation, emojis, and the casing pattern (ALL CAPS stays ALL CAPS, lowercase stays lowercase). Do NOT add commentary, quotes, or explanations. If the input is already in ${tgt}, return it unchanged. Output ONLY the translated text.`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: data.text },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return { ok: false, error: "rate_limited" };
      if (response.status === 402) return { ok: false, error: "payment_required" };
      const t = await response.text();
      console.error("[translate] gateway error", response.status, t);
      return { ok: false, error: `gateway_${response.status}` };
    }

    const json = await response.json();
    const translated: string | undefined = json?.choices?.[0]?.message?.content?.trim();
    if (!translated) return { ok: false, error: "empty_response" };

    return { ok: true, translated };
  } catch (e) {
    console.error("[translate] failure", e);
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}