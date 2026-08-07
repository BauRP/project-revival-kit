import { AnimatePresence, motion } from "framer-motion";
import { BellOff, Mic, Paperclip, Send, Smile, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/hooks/use-toast";

interface MessageInputProps {
  value: string;
  placeholder: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onToggleEmoji: () => void;
  onToggleAttach: () => void;
  /** Called with a recorded voice blob when the user taps the send/stop button. */
  onVoiceRecorded?: (file: File, durationMs: number) => void;
  /** Optional slot rendered ABOVE the input bar (e.g. upload overlay). */
  overlaySlot?: ReactNode;
  /** Silent send toggle — when true, recipient gets no notification ping. */
  silent?: boolean;
  onToggleSilent?: () => void;
  /** Long-press / click on the Send button while text exists — opens scheduler. */
  onSchedule?: () => void;
  /** One-time view toggle — next attached media will auto-purge after viewing. */
  oneTimeView?: boolean;
  onToggleOneTimeView?: () => void;
}

const actionTransition = { duration: 0.16, ease: "easeOut" } as const;

const formatDuration = (ms: number) => {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const MessageInput = ({
  value,
  placeholder,
  onValueChange,
  onSubmit,
  onToggleEmoji,
  onToggleAttach,
  onVoiceRecorded,
  overlaySlot,
  silent = false,
  onToggleSilent,
  onSchedule,
  oneTimeView = false,
  onToggleOneTimeView,
}: MessageInputProps) => {
  const hasText = value.trim().length > 0;
  const { t } = useLanguage();

  // Block 4 — Tap-to-toggle recorder. The mic button starts a recording on
  // first tap; while recording, the SAME button morphs into a Send (stop +
  // upload) action and a sibling Trash button cancels without sending.
  // No long-press / pointer-capture gymnastics — every tap is honored.
  const { state: recState, durationMs, start, stop, cancel } = useVoiceRecorder({
    onError: () => {
      toast({ title: t("micPermissionDenied") || "Microphone permission denied", variant: "destructive" });
    },
  });
  const isRecording = recState === "recording" || recState === "requesting" || recState === "stopping";

  // Safety: if the picker/keyboard steals focus while recording, hard-cancel.
  useEffect(() => {
    if (!isRecording) return;
    const onVis = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isRecording, cancel]);

  const handleMicTap = async () => {
    if (hasText) return;
    if (isRecording) {
      // Tap = stop + send.
      const file = await stop();
      if (!file) return;
      if (durationMs < 1000) {
        toast({ title: t("recordingHold") || "Hold to record" });
        return;
      }
      onVoiceRecorded?.(file, durationMs);
      return;
    }
    await start();
  };

  const handleCancelRecording = () => {
    cancel();
  };

  // Native-level value mirror. Autofill, clipboard paste, drag-and-drop, IME
  // commits and Android keyboard suggestions do not always emit a React
  // synthetic change, so we listen on the DOM node itself and push the real
  // value up. This is what keeps the Mic -> Send swap in sync.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    const sync = () => {
      const next = node.value;
      if (next !== value) onValueChange(next);
    };
    const deferredSync = () => window.setTimeout(sync, 0);
    node.addEventListener("input", sync);
    node.addEventListener("change", sync);
    node.addEventListener("keyup", sync);
    node.addEventListener("compositionend", deferredSync);
    node.addEventListener("paste", deferredSync);
    node.addEventListener("cut", deferredSync);
    node.addEventListener("drop", deferredSync);
    return () => {
      node.removeEventListener("input", sync);
      node.removeEventListener("change", sync);
      node.removeEventListener("keyup", sync);
      node.removeEventListener("compositionend", deferredSync);
      node.removeEventListener("paste", deferredSync);
      node.removeEventListener("cut", deferredSync);
      node.removeEventListener("drop", deferredSync);
    };
  }, [value, onValueChange]);

  return (
    <>
      {/* Slot for upload overlay (Block 3). Rendered above the recording pill
          so both can coexist if a previous upload is still in flight. */}
      {overlaySlot}

      {/* Recording overlay — neon-green pulsing pill above the input bar */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            key="rec-overlay"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
            className="px-3 pb-2 will-change-transform"
          >
            <div className="glass-panel-sm border border-emerald-400/40 rounded-full px-4 py-2 flex items-center gap-3">
              <motion.span
                animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 1.1, repeat: Infinity }}
                className="w-2.5 h-2.5 rounded-full bg-emerald-400"
                style={{ boxShadow: "0 0 12px rgb(52 211 153 / 0.8), 0 0 24px rgb(52 211 153 / 0.4)" }}
              />
              <span className="text-xs font-mono tabular-nums text-emerald-400">{formatDuration(durationMs)}</span>
              <span className="flex-1 text-[11px] truncate text-muted-foreground">
                {t("recordingRelease") || "Tap send to finish, trash to cancel"}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="glass-panel rounded-none border-x-0 border-b-0 shrink-0 p-1.5 flex items-center gap-1.5">
        {/* While recording the left controls morph into a Cancel (trash) button
            so the user has an unmistakable kill switch. */}
        {isRecording ? (
          <button
            type="button"
            onClick={handleCancelRecording}
            className="p-2 rounded-xl bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
            aria-label={t("recordingCancel") || "Cancel recording"}
          >
            <Trash2 size={20} />
          </button>
        ) : (
          <>
            <button type="button" onClick={onToggleEmoji} className="p-2 text-muted-foreground" aria-label="Emoji">
              <Smile size={20} />
            </button>
            <button type="button" onClick={onToggleAttach} className="p-2 text-muted-foreground" aria-label="Attachment">
              <Paperclip size={20} />
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          // Controlled value strictly bound to the OS-processed text string.
          // No physical-key interception — the IME / OS keyboard layout
          // (Cyrillic, Kazakh, etc.) hands us the already-translated chars.
          onChange={(e) => onValueChange(e.target.value)}
          onInput={(e) => onValueChange((e.target as HTMLInputElement).value)}
          onCompositionEnd={(e) => onValueChange((e.target as HTMLInputElement).value)}
          onPaste={(e) => {
            // Let the browser perform the native paste (this preserves the OS
            // clipboard encoding for Cyrillic / CJK text), then read the real
            // input value back on the next frame so the Mic -> Send swap fires.
            const target = e.currentTarget;
            window.setTimeout(() => onValueChange(target.value), 0);
          }}
          onDrop={(e) => {
            const target = e.currentTarget;
            window.setTimeout(() => onValueChange(target.value), 0);
          }}
          onKeyDown={(e) => {
            // Layout-agnostic submission — compare the string literal name only.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (value.trim().length > 0) onSubmit();
            }
          }}
          placeholder={isRecording ? "" : placeholder}
          readOnly={isRecording}
          dir="auto"
          inputMode="text"
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck={true}
          className="glass-input flex-1 py-1.5 px-2.5 text-sm"
        />
        <div className="relative h-10 w-10 shrink-0">
          <AnimatePresence mode="wait" initial={false}>
            {hasText ? (
              <motion.button
                key="send"
                type="button"
                initial={{ opacity: 0, scale: 0.88, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.88, y: -4 }}
                transition={actionTransition}
                onClick={onSubmit}
                onContextMenu={(e) => {
                  if (!onSchedule) return;
                  e.preventDefault();
                  onSchedule();
                }}
                onPointerDown={(e) => {
                  if (!onSchedule) return;
                  const target = e.currentTarget;
                  const t = window.setTimeout(() => onSchedule(), 500);
                  const clear = () => { window.clearTimeout(t); target.removeEventListener("pointerup", clear); target.removeEventListener("pointerleave", clear); target.removeEventListener("pointercancel", clear); };
                  target.addEventListener("pointerup", clear);
                  target.addEventListener("pointerleave", clear);
                  target.addEventListener("pointercancel", clear);
                }}
                className="absolute inset-0 flex items-center justify-center rounded-xl bg-primary text-primary-foreground"
                style={silent ? { boxShadow: "0 0 12px rgb(0 255 255 / 0.55)" } : undefined}
                aria-label={silent ? "Send silently (long-press to schedule)" : "Send message (long-press to schedule)"}
                title={onSchedule ? "Hold to schedule" : undefined}
              >
                {silent ? <BellOff size={18} /> : <Send size={18} />}
              </motion.button>
            ) : (
              <motion.button
                key="mic"
                type="button"
                initial={{ opacity: 0, scale: 0.88, y: 4 }}
                animate={{ opacity: 1, scale: isRecording ? 1.08 : 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.88, y: -4 }}
                transition={actionTransition}
                onClick={handleMicTap}
                onContextMenu={(e) => e.preventDefault()}
                className={`absolute inset-0 flex items-center justify-center rounded-xl transition-colors select-none will-change-transform ${
                  isRecording
                    ? "bg-emerald-500 text-white"
                    : "bg-secondary text-secondary-foreground"
                }`}
                style={
                  isRecording
                    ? { boxShadow: "0 0 16px rgb(16 185 129 / 0.7), 0 0 32px rgb(16 185 129 / 0.35)" }
                    : undefined
                }
                aria-label={isRecording ? "Tap to send recording" : "Tap to start recording"}
              >
                {isRecording ? <Send size={18} /> : <Mic size={18} />}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
};

export default MessageInput;
