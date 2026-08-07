import { AlertTriangle, ChevronDown, ChevronUp, Languages, Loader2, RotateCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

interface TranslationPlateProps {
  translatedText: string;
  sent: boolean;
  translating?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

/**
 * Inline translation plate for INCOMING bubbles. Expands UPWARDS from the
 * toggle row, with a "translating…" indicator while the LLM call is in
 * flight and a retry affordance on failure.
 */
const TranslationPlate = ({ translatedText, sent, translating, error, onRetry }: TranslationPlateProps) => {
  // Spec §3 — translation block must start COLLAPSED. User taps the
  // "ПЕРЕВОД" header to expand it.
  const [open, setOpen] = useState(false);

  const tone = sent
    ? "bg-primary-foreground/15 text-primary-foreground/90 hover:bg-primary-foreground/20"
    : "bg-background/60 text-foreground/80 hover:bg-background/80";

  const showPanel = open && (translatedText || translating || error);

  return (
    <motion.div layout="position" className="mt-1 w-full flex flex-col">
      <AnimatePresence initial={false}>
        {showPanel && (
          <motion.div
            key="plate"
            layout
            initial={{ height: 0, opacity: 0, y: 8, marginBottom: 0 }}
            animate={{ height: "auto", opacity: 1, y: 0, marginBottom: 4 }}
            exit={{ height: 0, opacity: 0, y: 8, marginBottom: 0 }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            className="w-full overflow-hidden"
          >
            <div
              className={`w-full px-3 py-2 rounded-lg text-xs leading-relaxed break-words ${
                sent
                  ? "bg-primary-foreground/10 text-primary-foreground/95"
                  : "bg-background/70 text-foreground/90"
              }`}
            >
              {translating && !translatedText && (
                <span className="inline-flex items-center gap-1.5 opacity-80">
                  <Loader2 size={12} className="animate-spin" />
                  переводим…
                </span>
              )}
              {!translating && error && !translatedText && (
                <span className="inline-flex items-center gap-2 text-amber-400">
                  <AlertTriangle size={12} />
                  Не удалось перевести
                  {onRetry && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRetry(); }}
                      className="inline-flex items-center gap-1 underline hover:opacity-90"
                    >
                      <RotateCw size={11} /> Повторить
                    </button>
                  )}
                </span>
              )}
              {translatedText}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${tone}`}
        aria-expanded={open}
        aria-label={open ? "Скрыть перевод" : "Показать перевод"}
      >
        <Languages size={11} className="shrink-0" />
        <span className="flex-1 text-left tracking-wide uppercase opacity-80">
          {translating ? "Перевод…" : open ? "Перевод" : "Перевести"}
        </span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
    </motion.div>
  );
};

export default TranslationPlate;
