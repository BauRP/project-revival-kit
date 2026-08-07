import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X } from "lucide-react";

interface UploadOverlayProps {
  /** When true, the banner is rendered above the message input. */
  visible: boolean;
  /** Optional name of the file being uploaded — shown for context. */
  fileName?: string;
  /** Translated label, e.g. "Uploading…". */
  label: string;
  /** Cancel button accessible label. */
  cancelLabel: string;
  /** Cancel handler — must abort the upload AND clear the visible state. */
  onCancel: () => void;
  /** Upload progress as a 0–100 number. Negative / undefined → indeterminate. */
  progress?: number;
  /** Optional pretty size string ("12.4 MB / 980 MB"). */
  sizeLabel?: string;
}

/**
 * Block 3 — Upload status overlay.
 *
 * Sits directly above the MessageInput (WhatsApp / Telegram pattern). Now
 * includes a real-time progress bar so 1 GB transfers to the Trivo server
 * are visible to the user, plus a hard cancel control so a hung upload
 * never traps the UI.
 */
const UploadOverlay = ({
  visible,
  fileName,
  label,
  cancelLabel,
  onCancel,
  progress,
  sizeLabel,
}: UploadOverlayProps) => {
  const hasProgress = typeof progress === "number" && progress >= 0;
  const pct = hasProgress ? Math.max(0, Math.min(100, progress as number)) : 0;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="upload-overlay"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18 }}
          className="px-3 pb-2 will-change-transform"
        >
          <div className="glass-panel-sm border border-primary/30 rounded-2xl px-3 py-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <Loader2 size={16} className="text-primary animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {label}
                  {hasProgress ? (
                    <span className="ml-2 text-primary font-mono tabular-nums">
                      {pct.toFixed(0)}%
                    </span>
                  ) : null}
                </p>
                {(fileName || sizeLabel) && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {fileName}
                    {fileName && sizeLabel ? " — " : ""}
                    {sizeLabel}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label={cancelLabel}
                className="p-1.5 rounded-full hover:bg-destructive/15 text-destructive transition-colors shrink-0"
              >
                <X size={14} />
              </button>
            </div>
            <div className="h-1.5 w-full rounded-full bg-primary/10 overflow-hidden">
              {hasProgress ? (
                <motion.div
                  className="h-full bg-primary"
                  style={{ boxShadow: "0 0 8px hsl(var(--primary) / 0.6)" }}
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                />
              ) : (
                <motion.div
                  className="h-full w-1/3 bg-primary/70"
                  animate={{ x: ["-100%", "300%"] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default UploadOverlay;
