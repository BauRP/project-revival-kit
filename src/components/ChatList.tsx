import { Star, Check, CheckCheck, MoreVertical, VolumeX, Trash2, Ban, TimerReset, Archive, ArchiveRestore, ChevronDown } from "lucide-react";
import { motion, AnimatePresence, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import DefaultAvatar from "./DefaultAvatar";
import MuteModal from "./MuteModal";
import DisappearingMessagesModal from "./DisappearingMessagesModal";
import { getAllChatMetas, getChatMeta, saveChatMeta, clearMessagesForChat, type ChatMeta } from "@/lib/p2p";
import { dbGet, dbPut, dbDelete } from "@/lib/storage";
import { isTrivoSupport, SUPPORT_BOT_NAME } from "@/lib/mock-peer";
import { getChatPreferences, getMuteUntil, isMuted, updateChatPreferences, type DisappearingDuration } from "@/lib/chat-preferences";
import { blockUser, unblockUser, submitReport } from "@/lib/report";
import { toast } from "@/hooks/use-toast";
import ContactAssignSheet from "./ContactAssignSheet";
import ContactActionsMenu from "./ContactActionsMenu";

interface Chat {
  id: string;
  name: string;
  avatar?: string | null;
  lastMessage: string;
  time: string;
  unread: number;
  starred: boolean;
  status: "sent" | "read";
  muted: boolean;
  blocked: boolean;
  archived: boolean;
  /** Disappearing messages active for this chat. */
  disappearing: boolean;
}

interface ChatListProps {
  onOpenChat: (chatId: string, name: string, emoji: string) => void;
  /** When set (and not the system "ВСЕ" tab), only chats assigned to this folder are shown. */
  activeFolderId?: string | null;
  /** True when activeFolderId is the system "ВСЕ" folder (show everything). */
  isSystemFolder?: boolean;
}

/** Phase 2 §1 — pixel threshold for swipe-to-archive / unarchive. */
const SWIPE_THRESHOLD = 90;
/** Pixel threshold for the pull-down overscroll that reveals the Archive row. */
const REVEAL_THRESHOLD = 60;

interface ChatRowProps {
  chat: Chat;
  view: "main" | "archive";
  onOpen: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onToggleStar: (e: React.MouseEvent) => void;
  onMenu: (e: React.MouseEvent) => void;
  onCloseMenu: () => void;
  menuOpen: boolean;
  // menu actions
  onMute: () => void;
  onClearChat: () => void;
  onToggleBlock: () => void;
  onToggleFavorite: () => void;
  onDeleteFriend: () => void;
  onAssign: () => void;
  onReport: () => void;
}

const ChatRow = ({
  chat, view, onOpen, onArchive, onUnarchive, onToggleStar, onMenu, onCloseMenu, menuOpen,
  onMute, onClearChat, onToggleBlock, onToggleFavorite, onDeleteFriend, onAssign, onReport,
}: ChatRowProps) => {
  const { t } = useLanguage();
  const x = useMotionValue(0);
  // Reveal a Cyan archive backdrop as the row slides left.
  const bgOpacity = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0.15]);

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    if (view === "main" && info.offset.x < -SWIPE_THRESHOLD) {
      onArchive();
    } else if (view === "archive" && info.offset.x < -SWIPE_THRESHOLD) {
      // Phase 2 §1 — inside Archive a left-swipe restores the chat.
      onUnarchive();
    }
    x.set(0);
  };

  return (
    <div className="relative" style={{ zIndex: menuOpen ? 30 : 1 }}>
      {/* Swipe action backdrop */}
      <motion.div
        className="absolute inset-0 flex items-center justify-end pr-6 rounded-xl"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(0,255,255,0.18))",
          opacity: bgOpacity,
        }}
        aria-hidden
      >
        <div className="flex items-center gap-2 text-[#00FFFF]">
          {view === "main" ? <Archive size={18} /> : <ArchiveRestore size={18} />}
          <span className="text-xs uppercase tracking-wide font-semibold">
            {view === "main" ? t("archive") : t("restore")}
          </span>
        </div>
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -SWIPE_THRESHOLD * 1.4, right: 0 }}
        dragElastic={{ left: 0.2, right: 0 }}
        style={{ x }}
        onDragEnd={handleDragEnd}
        className="relative"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen();
            }
          }}
          className="w-full flex items-center gap-3 p-3 rounded-xl glass-panel-sm hover:neon-border transition-all text-left bg-background"
        >
          <DefaultAvatar src={chat.avatar} size={48} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground truncate">{chat.name}</span>
              {chat.disappearing && (
                <TimerReset size={12} className="text-[#00FFFF] shrink-0" style={{ filter: "drop-shadow(0 0 4px rgba(0,255,255,0.6))" }} aria-label={t("disappearingMessages")} />
              )}
              <div className="ml-auto flex items-center gap-1 shrink-0">
                {chat.muted && <VolumeX size={12} className="text-muted-foreground" />}
                {chat.blocked && <Ban size={12} className="text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">{chat.time}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {chat.lastMessage ? (
                <>
                  {chat.status === "sent" ? (
                    <Check size={14} className="tick-sent shrink-0" />
                  ) : (
                    <CheckCheck size={14} className="tick-read shrink-0" />
                  )}
                  <span className="text-sm text-muted-foreground truncate">{chat.lastMessage}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("e2eSessionStarted") || "E2E Session"}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0 ml-1">
            <div className="flex items-center gap-1">
              <button onClick={onToggleStar} className="p-1">
                <Star
                  size={16}
                  className={chat.starred ? "fill-primary text-primary drop-shadow-[0_0_4px_hsl(var(--neon-glow)/0.5)]" : "text-muted-foreground/40"}
                />
              </button>
              {chat.unread > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center neon-glow">
                  {chat.unread}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onMenu}
            className="p-1 rounded-lg hover:bg-secondary/50 text-muted-foreground shrink-0"
          >
            <MoreVertical size={16} />
          </button>
        </div>
      </motion.div>

      <ContactActionsMenu
        open={menuOpen}
        onClose={onCloseMenu}
        state={{ muted: chat.muted, blocked: chat.blocked, favorite: chat.starred, archived: view === "archive" || chat.archived }}
        onMute={onMute}
        onToggleBlock={onToggleBlock}
        onToggleFavorite={onToggleFavorite}
        onToggleArchive={view === "main" ? onArchive : onUnarchive}
        onAssignGroup={onAssign}
        onClearChat={onClearChat}
        onReport={onReport}
        onDeleteFriend={onDeleteFriend}
      />
    </div>
  );
};

const ChatList = ({ onOpenChat, activeFolderId, isSystemFolder }: ChatListProps) => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [muteTarget, setMuteTarget] = useState<string | null>(null);
  const [disappearingTarget, setDisappearingTarget] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string } | null>(null);
  const [folderChatIds, setFolderChatIds] = useState<Set<string> | null>(null);
  const [view, setView] = useState<"main" | "archive">("main");
  const [pullProgress, setPullProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    const loadChats = async () => {
      const metas = await getAllChatMetas();
      const starred = (await dbGet<string[]>("settings", "starred-chats")) || [];
      const chatList: Chat[] = await Promise.all(metas.map(async (m: ChatMeta) => {
        const preferences = await getChatPreferences(m.friendId);
        return {
          id: m.friendId,
          name: isTrivoSupport(m.friendId) ? SUPPORT_BOT_NAME : m.friendName,
          avatar: m.friendAvatar || null,
          lastMessage: m.lastMessage || (t("e2eSessionStarted") || "E2E Encrypted Session Started"),
          time: m.lastMessageTime
            ? new Date(m.lastMessageTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "",
          unread: m.unread,
          starred: starred.includes(m.friendId) || !!preferences.favorite,
          status: "sent" as const,
          muted: isMuted(preferences.mutedUntil),
          blocked: !!preferences.blocked,
          archived: !!preferences.archived,
          disappearing: !!preferences.disappearingDuration && preferences.disappearingDuration !== "off",
        };
      }));
      setChats(chatList);
    };
    loadChats();
    const interval = setInterval(loadChats, 3000);
    return () => clearInterval(interval);
  }, [t]);

  const toggleStar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, starred: !c.starred } : c)));
    const starred = (await dbGet<string[]>("settings", "starred-chats")) || [];
    const updated = starred.includes(id) ? starred.filter((s) => s !== id) : [...starred, id];
    await dbPut("settings", "starred-chats", updated);
  };

  const archiveChat = async (id: string) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, archived: true } : c)));
    await updateChatPreferences(id, { archived: true });
    toast({ title: t("chatArchivedToast"), description: t("pullToOpenArchive") });
    setMenuOpen(null);
  };

  const unarchiveChat = async (id: string) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, archived: false } : c)));
    await updateChatPreferences(id, { archived: false });
    toast({ title: t("chatRestored") });
    setMenuOpen(null);
  };

  const clearChat = (id: string) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, lastMessage: "", unread: 0 } : c)));
    setMenuOpen(null);
  };

  const toggleBlock = async (id: string) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, blocked: !c.blocked } : c)));
    const nextBlocked = !chats.find((c) => c.id === id)?.blocked;
    await updateChatPreferences(id, { blocked: nextBlocked });
    if (nextBlocked) await blockUser(id); else await unblockUser(id);
    setMenuOpen(null);
  };

  const deleteChat = (id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
    setMenuOpen(null);
  };

  const handleMute = (duration: string) => {
    if (muteTarget) {
      setChats((prev) => prev.map((c) => (c.id === muteTarget ? { ...c, muted: true } : c)));
      void updateChatPreferences(muteTarget, { mutedUntil: getMuteUntil(duration as DisappearingDuration | "always") });
    }
    setMuteTarget(null);
    setMenuOpen(null);
  };

  /** Menu row acts as a switch: muted chats are un-muted with a single tap. */
  const handleMuteMenu = async (id: string) => {
    const chat = chats.find((c) => c.id === id);
    if (chat?.muted) {
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, muted: false } : c)));
      await updateChatPreferences(id, { mutedUntil: null });
      setMenuOpen(null);
      toast({ title: t("unmute") });
      return;
    }
    setMuteTarget(id);
  };

  const handleDisappearing = async (duration: DisappearingDuration) => {
    if (!disappearingTarget) return;
    await updateChatPreferences(disappearingTarget, { disappearingDuration: duration });
    setDisappearingTarget(null);
    setMenuOpen(null);
  };

  // Phase 2 §1 — pull-down detector. Triggers Archive view when the user
  // overscrolls the top of the main list past REVEAL_THRESHOLD.
  const onWheel = (e: React.WheelEvent) => {
    if (view !== "main") return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) { setPullProgress(0); return; }
    if (e.deltaY < 0) {
      setPullProgress((p) => Math.min(1, p + Math.abs(e.deltaY) / REVEAL_THRESHOLD));
    }
  };

  const touchStart = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (view !== "main") return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    touchStart.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStart.current == null) return;
    const dy = e.touches[0].clientY - touchStart.current;
    if (dy > 0) setPullProgress(Math.min(1, dy / REVEAL_THRESHOLD));
  };
  const onTouchEnd = () => {
    if (pullProgress >= 1) setView("archive");
    touchStart.current = null;
    setPullProgress(0);
  };

  // Folder filter — load assignments when activeFolderId changes (custom folder only).
  useEffect(() => {
    let cancelled = false;
    if (!activeFolderId || isSystemFolder) {
      setFolderChatIds(null);
      return;
    }
    // Clear the previous folder's ids immediately so the list never renders
    // a stale membership set while the new folder loads.
    setFolderChatIds(new Set());
    import("@/lib/folder-assignments").then(({ getChatsInFolder, onAssignmentsChange }) => {
      const refresh = () => getChatsInFolder(activeFolderId).then((ids) => { if (!cancelled) setFolderChatIds(new Set(ids)); });
      refresh();
      const unsub = onAssignmentsChange(refresh);
      return unsub;
    });
    return () => { cancelled = true; };
  }, [activeFolderId, isSystemFolder]);

  const folderFiltered = folderChatIds ? chats.filter((c) => folderChatIds.has(c.id)) : chats;
  const visible = folderFiltered.filter((c) => view === "archive" ? c.archived : !c.archived);
  const archivedCount = chats.filter((c) => c.archived).length;
  const sorted = [...visible].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    return 0;
  });

  if (chats.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="header-safe-zone px-5 pb-4 shrink-0">
          <h1 className="text-2xl font-bold gradient-text">{t("chats")}</h1>
        </div>
        <div className="flex-1 flex items-center justify-center px-8">
          <p className="text-sm text-muted-foreground text-center">
            {t("noActiveChats")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="header-safe-zone px-5 pb-4 shrink-0 flex items-center justify-between">
        <h1 className="text-2xl font-bold gradient-text">
          {view === "archive" ? t("archive") : t("chats")}
        </h1>
        {view === "archive" && (
          <button
            onClick={() => setView("main")}
            className="text-xs text-[#00FFFF] uppercase tracking-wide font-semibold flex items-center gap-1"
          >
            ← {t("chats")}
          </button>
        )}
      </div>

      {/* Pull-down hint — appears as the user overscrolls. */}
      <AnimatePresence>
        {view === "main" && pullProgress > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: pullProgress, height: 36 * pullProgress }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden flex items-center justify-center gap-2 text-[#00FFFF]"
          >
            <ChevronDown size={14} />
            <span className="text-[11px] uppercase tracking-wide font-semibold">
              {t("pullToOpenArchive")} ({archivedCount})
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-hide px-3 space-y-1.5 pb-20"
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Archive folder card — visible at top of main list whenever there
            are archived chats. Tapping opens the archive view directly. */}
        {view === "main" && archivedCount > 0 && (
          <button
            onClick={() => setView("archive")}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#00FFFF]/30 bg-black/60 hover:bg-[#00FFFF]/5 transition-colors text-left"
            style={{ boxShadow: "inset 0 0 12px rgba(0,255,255,0.08)" }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#00FFFF]/10 border border-[#00FFFF]/40">
              <Archive size={20} className="text-[#00FFFF]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground">{t("archive")}</p>
              <p className="text-xs text-muted-foreground">{archivedCount}</p>
            </div>
          </button>
        )}

        <AnimatePresence>
          {sorted.map((chat) => (
            <motion.div
              key={chat.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ duration: 0.18 }}
            >
              <ChatRow
                chat={chat}
                view={view}
                menuOpen={menuOpen === chat.id}
                onOpen={async () => {
                  // Spec §2 — Mark-as-Read: immediately reset the unread count
                  // in BOTH local state and persistent meta so the badge does
                  // not reappear on the next 3s refresh poll.
                  setChats((prev) => prev.map((c) => c.id === chat.id ? { ...c, unread: 0 } : c));
                  const existing = await getChatMeta(chat.id);
                  if (existing) {
                    await saveChatMeta({ ...existing, unread: 0 });
                  }
                  onOpenChat(chat.id, chat.name, "");
                }}
                onArchive={() => archiveChat(chat.id)}
                onUnarchive={() => unarchiveChat(chat.id)}
                onToggleStar={(e) => toggleStar(e, chat.id)}
                onMenu={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === chat.id ? null : chat.id); }}
                onCloseMenu={() => setMenuOpen(null)}
                onMute={() => { void handleMuteMenu(chat.id); }}
                onClearChat={async () => { await clearMessagesForChat(chat.id); clearChat(chat.id); toast({ title: t("chatCleared") }); }}
                onToggleBlock={() => toggleBlock(chat.id)}
                onToggleFavorite={() => { const fake = { stopPropagation() {} } as React.MouseEvent; toggleStar(fake, chat.id); setMenuOpen(null); }}
                onDeleteFriend={async () => { await clearMessagesForChat(chat.id); try { await dbDelete("contacts", chat.id); } catch { /* ignore */ } deleteChat(chat.id); toast({ title: "Друг удалён" }); }}
                onAssign={() => { setAssignTarget({ id: chat.id, name: chat.name }); setMenuOpen(null); }}
                onReport={async () => { await submitReport(chat.id, "harassment"); setMenuOpen(null); toast({ title: t("reportSubmitted"), description: t("autoBlockedDesc") }); }}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {view === "archive" && sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
            <Archive size={32} className="text-[#00FFFF]/60" />
            <p className="text-sm text-muted-foreground">{t("archiveEmpty")}</p>
          </div>
        )}
      </div>
      <MuteModal open={!!muteTarget} onClose={() => setMuteTarget(null)} onMute={handleMute} />
      <DisappearingMessagesModal open={!!disappearingTarget} onClose={() => setDisappearingTarget(null)} onSelect={handleDisappearing} />
      <ContactAssignSheet
        open={!!assignTarget}
        chatId={assignTarget?.id || null}
        chatName={assignTarget?.name}
        onClose={() => setAssignTarget(null)}
      />
    </div>
  );
};

export default ChatList;
