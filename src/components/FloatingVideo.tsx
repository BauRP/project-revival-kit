import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Pause, Play, Maximize2 } from "lucide-react";

export interface FloatingVideoSource {
  url: string;
  title?: string;
}

interface FloatingVideoProps {
  source: FloatingVideoSource | null;
  onClose: () => void;
  onExpand: () => void;
}

/**
 * Phase 2 §4 — Picture-in-Picture overlay.
 *
 * Web fallback — a draggable floating window pinned above the chat list.
 * On native Android the same source feeds Android's PIP mode (see
 * legacy/android/V2_NATIVE_TODO.md → FloatingVideoEngine.kt).
 */
const FloatingVideo = ({ source, onClose, onExpand }: FloatingVideoProps) => {
  const [paused, setPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== "undefined" ? Math.max(window.innerWidth - 200, 12) : 12,
    y: 80,
  }));

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause(); else v.play().catch(() => {});
  }, [paused, source]);

  if (!source) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const W = 192, H = 108;
    const nx = Math.min(Math.max(dragStart.current.ox + dx, 4), window.innerWidth - W - 4);
    const ny = Math.min(Math.max(dragStart.current.oy + dy, 4), window.innerHeight - H - 4);
    setPos({ x: nx, y: ny });
  };
  const onPointerUp = () => { dragStart.current = null; };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      className="fixed z-50 rounded-lg overflow-hidden bg-black border border-[#00FFFF]/60 select-none"
      style={{
        left: pos.x,
        top: pos.y,
        width: 192,
        height: 108,
        boxShadow: "0 0 18px rgba(0,255,255,0.45)",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="dialog"
      aria-label={source.title || "Floating video"}
    >
      <video
        ref={videoRef}
        src={source.url}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        autoPlay
        muted
        playsInline
        loop
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 p-1 bg-gradient-to-t from-black/80 to-transparent">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPaused((p) => !p); }}
          className="p-1 rounded text-[#00FFFF] hover:bg-[#00FFFF]/15"
          aria-label={paused ? "Play" : "Pause"}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          className="p-1 rounded text-[#00FFFF] hover:bg-[#00FFFF]/15"
          aria-label="Return to fullscreen"
        >
          <Maximize2 size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-1 rounded text-[#00FFFF] hover:bg-destructive/30 hover:text-destructive"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
};

export default FloatingVideo;
