/**
 * Legacy endpoint retained for API compatibility only. A private audio
 * message must never be fetched by this server or uploaded to third-party AI.
 * Offline ASR requires a separately bundled and verified on-device model.
 */
export interface TranscribeAudioInput {
  audioUrl: string;
}
export type TranscribeAudioResult =
  | { ok: true; text: string }
  | { ok: false; error: string };
export async function transcribeAudioServer(
  _input: TranscribeAudioInput,
): Promise<TranscribeAudioResult> {
  return { ok: false, error: "offline_speech_model_not_installed" };
}
