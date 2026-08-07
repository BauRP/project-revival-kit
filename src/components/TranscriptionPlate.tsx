// Phase 3 §2 — Transcription plate for incoming voice messages.
// "A/文" toggle that calls the STT server fn and renders the result inside
// a Neon-Cyan-bordered box directly under the audio waveform.

import { useState } from "react";
import { Languages, Loader2, RotateCcw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { transcribeAudio } from "@/lib/transcribe.functions";
import { cacheTranscription, getCachedTranscription } from "@/lib/stt-cache";

interface Props {
  audioUrl: string;
}

const TranscriptionPlate = ({ audioUrl }: Props) => {
  const [text, setText] = useState<string | null>(() => getCachedTranscription(audioUrl));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcribeFn = useServerFn(transcribeAudio);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await transcribeFn({ data: { audioUrl } });
      if (result.ok) {
        setText(result.text);
        cacheTranscription(audioUrl, result.text);
        setOpen(true);
      } else {
        setError(result.error);
        setOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    if (text) {
      setOpen((v) => !v);
      return;
    }
    void run();
  };

  return (
    <div className="mt-1.5 flex flex-col items-start gap-1.5 w-full">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-label="Расшифровать голосовое сообщение"
        title="Расшифровать"
        className="self-end inline-flex items-center justify-center w-7 h-7 rounded-md border border-[#00FFFF]/40 bg-black text-[#00FFFF] hover:bg-[#00FFFF]/10 transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
      </button>

      {open && (text || error) && (
        <div
          className="w-full rounded-lg border border-[#00FFFF]/60 bg-black/80 px-3 py-2"
          style={{ boxShadow: "0 0 8px rgba(0,255,255,0.25)" }}
        >
          {text ? (
            <p className="text-xs leading-relaxed text-[#E6FFFF] whitespace-pre-wrap break-words">{text}</p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-[#FF6B6B]">Не удалось расшифровать ({error})</p>
              <button
                type="button"
                onClick={run}
                className="inline-flex items-center gap-1 text-[11px] text-[#00FFFF] hover:underline"
              >
                <RotateCcw size={12} /> Повторить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TranscriptionPlate;
