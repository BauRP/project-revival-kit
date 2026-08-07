import { motion, AnimatePresence } from "framer-motion";

/** Phase 2 §5 — seven core emoji reactions. */
export const REACTION_EMOJIS = ["👍", "❤️", "🔥", "😂", "😮", "😢", "🙏"] as const;
export type ReactionEmoji = typeof REACTION_EMOJIS[number];

interface ReactionsBarProps {
  visible: boolean;
  onPick: (emoji: ReactionEmoji) => void;
  onDismiss: () => void;
  /** Anchor the bar to the bubble side so it doesn't overflow the viewport. */
  align?: "start" | "end";
}

/**
 * Floating Neon-Cyan reaction bar that pops up above a bubble on double-tap.
 * Picking an emoji triggers a slight scale animation handled by framer-motion
 * on the parent (the bubble's reaction badge).
 */
const ReactionsBar = ({ visible, onPick, onDismiss, align = "start" }: ReactionsBarProps) => {
  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Click-away catcher */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onDismiss}
            className="fixed inset-0 z-30"
            aria-hidden
          />
          <motion.div
            key="reactions-bar"
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className={`absolute z-40 -top-12 ${align === "end" ? "right-0" : "left-0"} flex items-center gap-1 rounded-full px-2 py-1.5 bg-black border border-[#00FFFF]/60`}
            style={{ boxShadow: "0 0 16px rgba(0,255,255,0.45), 0 0 32px rgba(0,255,255,0.15)" }}
            role="toolbar"
            aria-label="Quick reactions"
          >
            {REACTION_EMOJIS.map((emoji) => (
              <motion.button
                key={emoji}
                type="button"
                whileTap={{ scale: 1.4 }}
                whileHover={{ scale: 1.2 }}
                onClick={(e) => { e.stopPropagation(); onPick(emoji); }}
                className="text-xl leading-none px-1 py-0.5 select-none"
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </motion.button>
            ))}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ReactionsBar;
