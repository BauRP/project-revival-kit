import { describe, expect, it } from "vitest";
import { cacheTranscription, clearCachedTranscriptions, getCachedTranscription } from "../stt-cache";
import { translateTextServer } from "../server/translate.server";
import { transcribeAudioServer } from "../server/transcribe.server";
import { translateLLM } from "../translate-client";

describe("no cloud exfiltration of E2EE conversations", () => {
  it("refuses the retired hosted text and audio endpoints", async () => {
    expect(await translateTextServer({
      text: "secret", sourceLanguage: "en", targetLanguage: "ru",
    })).toEqual({ ok: false, error: "offline_only_translation" });
    expect(await transcribeAudioServer({
      audioUrl: "https://example.com/private.mp3",
    })).toEqual({ ok: false, error: "offline_speech_model_not_installed" });
  });
  it("does not send unsupported translations to any network gateway", async () => {
    expect(await translateLLM("hello", "xx", "yy")).toBeNull();
  });
  it("holds transcriptions in RAM and can clear them instantly", () => {
    clearCachedTranscriptions();
    cacheTranscription("blob:secret", "private speech");
    expect(getCachedTranscription("blob:secret")).toBe("private speech");
    clearCachedTranscriptions();
    expect(getCachedTranscription("blob:secret")).toBeNull();
  });
});
