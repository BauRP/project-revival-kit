import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface SelectiveCopySheetProps {
  open: boolean;
  text: string;
  onClose: () => void;
}

/**
 * Phase 2 §2 — Selective copy sheet.
 *
 * Replaces the "Copy All" default with a text-selection surface. The user can
 * drag word-by-word to highlight a sub-range, then tap "Copy selection" to
 * write it to the clipboard. Uses the native Selection API so on Android the
 * platform's text-handle UI shows up as expected.
 */
const SelectiveCopySheet = ({ open, text, onClose }: SelectiveCopySheetProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelected("");
    // Pre-select the whole string so the user immediately sees the markers.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      setSelected(text);
    });
    const onSel = () => {
      const s = window.getSelection()?.toString() || "";
      setSelected(s);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [open, text]);

  const copy = async () => {
    const value = selected.trim() || text;
    await navigator.clipboard.writeText(value);
    toast({ title: "Скопировано", description: value.length > 40 ? value.slice(0, 40) + "…" : value });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 z-40"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-50 bg-black border-t border-[#00FFFF]/40 rounded-t-2xl p-4 pb-6"
            style={{ boxShadow: "0 -8px 24px rgba(0,255,255,0.2)" }}
            role="dialog"
            aria-label="Selective copy"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wide text-[#00FFFF] font-semibold">
                Частичное копирование
              </p>
              <button onClick={onClose} className="p-1 text-muted-foreground" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div
              ref={ref}
              className="text-sm text-foreground bg-secondary/30 rounded-lg p-3 max-h-60 overflow-y-auto select-text"
              style={{ userSelect: "text", WebkitUserSelect: "text" }}
            >
              {text}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Выделите фрагмент, перетаскивая маркеры. Затем нажмите «Скопировать».
            </p>
            <button
              type="button"
              onClick={copy}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-[#00FFFF] text-black font-semibold py-2.5"
              style={{ boxShadow: "0 0 12px rgba(0,255,255,0.55)" }}
            >
              <Copy size={16} />
              {selected.trim() && selected !== text ? "Скопировать выделенное" : "Скопировать всё"}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default SelectiveCopySheet;
