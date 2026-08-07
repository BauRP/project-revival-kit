import { useFloatingVideo, setFloatingVideo } from "@/lib/floating-video-store";
import FloatingVideo from "./FloatingVideo";

interface FloatingVideoHostProps {
  /** Callback when the user taps "Return to Fullscreen" — usually re-opens the chat. */
  onExpand?: (url: string) => void;
}

/**
 * Phase 2 §4 — Always-mounted PiP host.
 *
 * Subscribes to the floating-video store and renders the draggable overlay
 * window above all chat surfaces. When the user closes it, the store clears.
 */
const FloatingVideoHost = ({ onExpand }: FloatingVideoHostProps) => {
  const source = useFloatingVideo();
  return (
    <FloatingVideo
      source={source}
      onClose={() => setFloatingVideo(null)}
      onExpand={() => {
        if (source) onExpand?.(source.url);
        setFloatingVideo(null);
      }}
    />
  );
};

export default FloatingVideoHost;
