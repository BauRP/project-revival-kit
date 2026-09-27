// Unified context-menu used by ChatList, FriendsList, and ChatRoom header.
// Spec order (strict, top → bottom):
//   1. Mute
//   2. Block / Unblock
//   3. Add to / Remove from Favorites
//   4. Archive / Unarchive
//   5. To Group / Create Group
//   6. Clear Chat
//   7. Report
//   8. Delete Friend
//
// Click-away closing: document-level mousedown/touchstart listener fires
// onClose when the click target is outside the menu's bounding ref.

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef } from "react";
import {
  VolumeX,
  Volume2,
  Ban,
  Star,
  StarOff,
  Archive,
  ArchiveRestore,
  FolderPlus,
  Trash2,
  Flag,
  UserMinus,
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export interface ContactActionsMenuState {
  muted: boolean;
  blocked: boolean;
  favorite: boolean;
  archived: boolean;
}

export interface ContactActionsMenuProps {
  open: boolean;
  onClose: () => void;
  state: ContactActionsMenuState;
  onMute: () => void;
  onToggleBlock: () => void;
  onToggleFavorite: () => void;
  onToggleArchive: () => void;
  onAssignGroup: () => void;
  onClearChat: () => void;
  onReport: () => void;
  onDeleteFriend: () => void;
  /** Optional override class for absolute positioning. */
  className?: string;
}

const Item = ({
  icon,
  label,
  destructive,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
  active?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-sm hover:bg-white/5 ${
      destructive ? "text-destructive" : "text-foreground"
    }`}
  >
    <span
      className={
        active ? "text-[#00FFFF]" : destructive ? "text-destructive" : "text-muted-foreground"
      }
    >
      {icon}
    </span>
    <span className="flex-1 text-left">{label}</span>
  </button>
);

const ContactActionsMenu = ({
  open,
  onClose,
  state,
  onMute,
  onToggleBlock,
  onToggleFavorite,
  onToggleArchive,
  onAssignGroup,
  onClearChat,
  onReport,
  onDeleteFriend,
  className,
}: ContactActionsMenuProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  // Click-away listener: closes the menu whenever the user clicks/taps
  // outside its bounding element. Uses capture phase so it fires before any
  // child stopPropagation handlers.
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent | TouchEvent) => {
      const node = ref.current;
      if (!node) return;
      const target = event.target as Node | null;
      if (target && node.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler, true);
    document.addEventListener("touchstart", handler, true);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", handler, true);
      document.removeEventListener("touchstart", handler, true);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.94, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: -4 }}
          transition={{ duration: 0.14 }}
          className={
            className ??
            "absolute right-3 top-12 min-w-[220px] rounded-xl border border-[#00FFFF]/30 bg-black z-40 py-1"
          }
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.6), 0 0 12px rgba(0,255,255,0.2)" }}
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <Item
            icon={state.muted ? <Volume2 size={16} /> : <VolumeX size={16} />}
            label={state.muted ? t("unmute") || "Unmute" : t("mute") || "Mute"}
            active={state.muted}
            onClick={onMute}
          />
          <Item
            icon={<Ban size={16} />}
            label={state.blocked ? t("unblock") || "Unblock" : t("block") || "Block"}
            active={state.blocked}
            onClick={onToggleBlock}
          />
          <Item
            icon={state.favorite ? <StarOff size={16} /> : <Star size={16} />}
            label={
              state.favorite
                ? t("removeFromFavorites") || "Remove from favorites"
                : t("addToFavorites") || "Add to favorites"
            }
            active={state.favorite}
            onClick={onToggleFavorite}
          />
          <Item
            icon={state.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            label={
              state.archived ? t("unarchiveAction") || "Unarchive" : t("archiveAction") || "Archive"
            }
            active={state.archived}
            onClick={onToggleArchive}
          />
          <Item
            icon={<FolderPlus size={16} />}
            label={t("groups") || "Groups"}
            onClick={onAssignGroup}
          />
          <Item
            icon={<Trash2 size={16} />}
            label={t("clearChat") || "Clear chat"}
            onClick={onClearChat}
          />
          <Item
            icon={<Flag size={16} />}
            label={t("reportUser") || "Report"}
            destructive
            onClick={onReport}
          />
          <Item
            icon={<UserMinus size={16} />}
            label={t("deleteFriend") || "Delete friend"}
            destructive
            onClick={onDeleteFriend}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ContactActionsMenu;
