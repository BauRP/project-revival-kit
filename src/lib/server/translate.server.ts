/**
 * Legacy endpoint retained for API compatibility only. Private E2EE chat
 * text must not be forwarded to a cloud AI provider.
 */
export interface TranslateTextInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}
export type TranslateTextResult =
  | { ok: true; translated: string }
  | { ok: false; error: string };
export async function translateTextServer(
  _input: TranslateTextInput,
): Promise<TranslateTextResult> {
  return { ok: false, error: "offline_only_translation" };
}
