// One-Time View full-screen media viewer.
//
// Renders a pure-black overlay with the media. On dismiss (close button,
// Escape, or backdrop tap) the `onConsumed` callback fires so the parent
// can purge the file from local cache + database. Web equivalent of
// Android's FLAG_SECURE: we set CSS that disables long-press save / context
// menu and discourages screenshots (best-effort only — true FLAG_SECURE
// must be wired natively on Android, see legacy/android/ TODO stubs).

import { motion, AnimatePresence } from "framer-motion";
import { Eye, X } from "lucide-react";
import { useEffect } from "react";

interface OneTimeViewerProps {
  open: boolean;
  url: string;
  mediaType: "image" | "video" | "audio" | "file";
  onClose: () => void;
  /** Fires once when the viewer is dismissed — caller MUST purge the file. */
  onConsumed: () => void;
}

const OneTimeViewer = ({ open, url, mediaType, onClose, onConsumed }: OneTimeViewerProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDismiss = () => {
    onClose();
    // Defer purge to next tick so the close animation can read the URL.
    queueMicrotask(() => onConsumed());
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
          onClick={handleDismiss}
          role="dialog"
          aria-label="One-time view media"
          style={{
            // Best-effort screenshot deterrent (true FLAG_SECURE is native).
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="absolute top-0 left-0 right-0 px-4 pt-[max(env(safe-area-inset-top),16px)] pb-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
            <div className="flex items-center gap-2 text-[#00FFFF]">
              <Eye size={18} />
              <span className="text-xs uppercase tracking-wider font-semibold">View once</span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
              className="p-2 rounded-full bg-white/5 text-white"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div
            className="max-w-[100vw] max-h-[100vh] flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {mediaType === "image" ? (
              <img
                src={url}
                alt=""
                draggable={false}
                className="max-w-full max-h-[90vh] object-contain"
              />
            ) : mediaType === "video" ? (
              <video
                src={url}
                autoPlay
                playsInline
                controls
                className="max-w-full max-h-[90vh]"
                onEnded={handleDismiss}
              />
            ) : (
              <div className="text-white/70 text-sm">Unsupported one-time media</div>
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 text-center bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-[11px] text-white/50 uppercase tracking-wider">
              Tap anywhere to close — media will be deleted
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OneTimeViewer;
