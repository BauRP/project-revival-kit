/**
 * Voice messages must remain on the user's phone. Do not invoke a remote
 * transcription function until a bundled offline ASR model is available.
 */
import { useState } from "react";
import { Languages } from "lucide-react";
import { getCachedTranscription } from "@/lib/stt-cache";

interface Props { audioUrl: string }

export default function TranscriptionPlate({ audioUrl }: Props) {
  const [open, setOpen] = useState(false);
  const cached = getCachedTranscription(audioUrl);
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1.5 w-full">
      <button type="button" onClick={() => setOpen((value) => !value)}
        aria-label="Информация об офлайн-расшифровке"
        title="Офлайн-расшифровка"
        className="self-end inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#00FFFF]/40 bg-black text-[#00FFFF] hover:bg-[#00FFFF]/10">
        <Languages size={14} />
      </button>
      {open && (
        <div role="status"
          className="w-full rounded-lg border border-[#00FFFF]/60 bg-black/80 px-3 py-2 text-xs leading-relaxed text-[#E6FFFF]">
          {cached || "Офлайн-модель распознавания речи ещё не установлена. Голосовые сообщения не отправляются стороннему сервису."}
        </div>
      )}
    </div>
  );
}
