// Masked placeholder bubble for one-time-view media.
// Shows a blurred/dotted icon indicator. Tap opens OneTimeViewer.
import { Eye } from "lucide-react";

interface OneTimeMediaBubbleProps {
  consumed?: boolean;
  sent: boolean;
  onOpen: () => void;
}

const OneTimeMediaBubble = ({ consumed, sent, onOpen }: OneTimeMediaBubbleProps) => {
  if (consumed) {
    return (
      <div className="rounded-xl px-3 py-2 border border-dashed border-foreground/20 text-[11px] uppercase tracking-wider text-muted-foreground italic">
        Opened — media deleted
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative w-44 h-44 rounded-xl overflow-hidden border-2 border-dashed border-[#00FFFF]/60 bg-black/60 flex flex-col items-center justify-center gap-2 hover:border-[#00FFFF] transition-colors"
      style={{ boxShadow: "0 0 12px rgba(0,255,255,0.25)" }}
      aria-label="Open one-time media"
    >
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{
          background: "repeating-linear-gradient(45deg, rgba(0,255,255,0.04) 0 6px, transparent 6px 12px)",
        }}
      />
      <div className="relative w-12 h-12 rounded-full border-2 border-dotted border-[#00FFFF] flex items-center justify-center">
        <Eye size={22} className="text-[#00FFFF]" />
      </div>
      <span className="relative text-[10px] uppercase tracking-wider text-[#00FFFF] font-semibold">
        View once
      </span>
      <span className="relative text-[9px] text-white/50">
        {sent ? "Sent privately" : "Tap to view — once"}
      </span>
    </button>
  );
};

export default OneTimeMediaBubble;
