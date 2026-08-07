import { MoreVertical, Star } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import DefaultAvatar from "./DefaultAvatar";
import MuteModal from "./MuteModal";
import ContactActionsMenu from "./ContactActionsMenu";
import ContactAssignSheet from "./ContactAssignSheet";
import { clearMessagesForChat, getAllChatMetas, type ChatMeta } from "@/lib/p2p";
import { subscribeToPresence, getPresenceStatus, onPresenceChange } from "@/lib/presence";
import { dbGet, dbPut, dbDelete } from "@/lib/storage";
import { blockUser, unblockUser, submitReport } from "@/lib/report";
import { isTrivoSupport, SUPPORT_BOT_NAME } from "@/lib/mock-peer";
import { getChatPreferences, getMuteUntil, updateChatPreferences, type DisappearingDuration } from "@/lib/chat-preferences";
import { subscribeToProfile, onProfileChange, getProfile } from "@/lib/profile";
import { toast } from "@/hooks/use-toast";

interface Friend {
  id: string;
  name: string;
  avatar?: string | null;
  status: "online" | "away" | "offline";
  customStatus: string;
  blocked: boolean;
  starred: boolean;
  archived: boolean;
  muted: boolean;
}

interface FriendsListProps {
  onOpenChat: (id: string, name: string, emoji: string) => void;
}

const statusColors = {
  online: "bg-primary",
  away: "bg-yellow-500",
  offline: "bg-muted-foreground/40",
};

const FriendsList = ({ onOpenChat }: FriendsListProps) => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [muteTarget, setMuteTarget] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string } | null>(null);
  const { t } = useLanguage();

  const loadFriends = async () => {
    const metas = await getAllChatMetas();
    const starred = (await dbGet<string[]>("settings", "starred-friends")) || [];
    const friendList: Friend[] = await Promise.all(metas.map(async (m: ChatMeta) => {
      const preferences = await getChatPreferences(m.friendId);
      const profile = getProfile(m.friendId);
      return {
        id: m.friendId,
        name: isTrivoSupport(m.friendId) ? SUPPORT_BOT_NAME : profile?.name || m.friendName,
        avatar: profile?.avatar ?? m.friendAvatar ?? null,
        status: getPresenceStatus(m.friendId),
        customStatus: profile?.status === "custom" ? profile.customStatus : "",
        blocked: !!preferences.blocked,
        starred: starred.includes(m.friendId) || !!preferences.favorite,
        archived: !!preferences.archived,
        muted: !!preferences.mutedUntil && preferences.mutedUntil > Date.now(),
      };
    }));
    setFriends(friendList);
  };

  useEffect(() => {
    loadFriends();
    const unsubPresence = onPresenceChange((userId, status) => {
      setFriends((prev) => prev.map((f) => f.id === userId ? { ...f, status } : f));
    });
    const interval = setInterval(loadFriends, 5000);
    return () => { clearInterval(interval); unsubPresence(); };
  }, []);

  useEffect(() => {
    const unsubs = friends.flatMap((f) => [subscribeToPresence(f.id), subscribeToProfile(f.id)]);
    return () => unsubs.forEach((u) => u());
  }, [friends.length]);

  // Live avatar / custom-status propagation, keyed by the contact's User ID.
  useEffect(() => {
    return onProfileChange((profile) => {
      setFriends((prev) =>
        prev.map((f) =>
          f.id === profile.userId
            ? {
                ...f,
                name: profile.name || f.name,
                avatar: profile.avatar ?? f.avatar,
                customStatus: profile.status === "custom" ? profile.customStatus : "",
              }
            : f,
        ),
      );
    });
  }, []);

  const closeMenu = () => setMenuOpen(null);

  const removeFriend = async (id: string) => {
    await clearMessagesForChat(id);
    try { await dbDelete("contacts", id); } catch { /* ignore */ }
    setFriends((prev) => prev.filter((f) => f.id !== id));
    closeMenu();
    toast({ title: t("friendRemoved") });
  };

  const clearChat = async (id: string) => {
    await clearMessagesForChat(id);
    closeMenu();
    toast({ title: t("chatCleared") });
  };

  const toggleBlock = async (id: string) => {
    const current = friends.find((f) => f.id === id);
    if (!current) return;
    const next = !current.blocked;
    setFriends((prev) => prev.map((f) => (f.id === id ? { ...f, blocked: next } : f)));
    await updateChatPreferences(id, { blocked: next });
    if (next) await blockUser(id); else await unblockUser(id);
    closeMenu();
  };

  const toggleStar = async (id: string) => {
    const current = friends.find((f) => f.id === id);
    if (!current) return;
    const next = !current.starred;
    setFriends((prev) => prev.map((f) => (f.id === id ? { ...f, starred: next } : f)));
    await updateChatPreferences(id, { favorite: next });
    const starred = (await dbGet<string[]>("settings", "starred-friends")) || [];
    const updated = next ? Array.from(new Set([...starred, id])) : starred.filter((s) => s !== id);
    await dbPut("settings", "starred-friends", updated);
    closeMenu();
  };

  const toggleArchive = async (id: string) => {
    const current = friends.find((f) => f.id === id);
    if (!current) return;
    const next = !current.archived;
    setFriends((prev) => prev.map((f) => (f.id === id ? { ...f, archived: next } : f)));
    await updateChatPreferences(id, { archived: next });
    closeMenu();
    toast({ title: next ? t("movedToArchive") : t("movedFromArchive") });
  };

  const report = async (id: string) => {
    await submitReport(id, "harassment");
    setFriends((prev) => prev.map((f) => (f.id === id ? { ...f, blocked: true } : f)));
    closeMenu();
    toast({ title: t("reportSubmitted"), description: t("autoBlockedDesc") });
  };

  const handleMute = async (duration: string) => {
    if (!muteTarget) return;
    await updateChatPreferences(muteTarget, {
      mutedUntil: getMuteUntil(duration as DisappearingDuration | "always"),
    });
    setFriends((prev) => prev.map((f) => (f.id === muteTarget ? { ...f, muted: true } : f)));
    setMuteTarget(null);
    closeMenu();
  };

  /**
   * Strict mute switch. When the contact is already muted the row unmutes
   * instantly and never opens the duration sheet; only an unmuted contact
   * opens the duration picker.
   */
  const handleMuteMenu = async (id: string) => {
    const friend = friends.find((f) => f.id === id);
    if (friend?.muted) {
      setFriends((prev) => prev.map((f) => (f.id === id ? { ...f, muted: false } : f)));
      await updateChatPreferences(id, { mutedUntil: null });
      closeMenu();
      toast({ title: t("unmute") });
      return;
    }
    closeMenu();
    setMuteTarget(id);
  };

  const statusLabelMap: Record<string, string> = {
    online: t("online"),
    away: t("away"),
    offline: t("offline"),
  };

  const sorted = [...friends].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    const statusOrder = { online: 0, away: 1, offline: 2 };
    return statusOrder[a.status] - statusOrder[b.status];
  });

  if (friends.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="header-safe-zone px-5 pb-4 flex items-center justify-between shrink-0">
          <h1 className="text-2xl font-bold gradient-text">{t("friends")}</h1>
          <span className="text-sm text-muted-foreground">0 {t("contacts")}</span>
        </div>
        <div className="flex-1 flex items-center justify-center px-8">
          <p className="text-sm text-muted-foreground text-center">{t("emptyFriendsList")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="header-safe-zone px-5 pb-4 flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold gradient-text">{t("friends")}</h1>
        <span className="text-sm text-muted-foreground">{friends.length} {t("contacts")}</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide px-3 space-y-1.5">
        <AnimatePresence>
          {sorted.map((friend, i) => (
            <motion.div
              key={friend.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-3 p-3 rounded-xl glass-panel-sm hover:neon-border transition-all relative cursor-pointer"
              style={{ zIndex: menuOpen === friend.id ? 30 : 1 }}
              onClick={() => onOpenChat(friend.id, friend.name, "")}
            >
              <div className="relative shrink-0">
                <DefaultAvatar src={friend.avatar} size={48} />
                <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background ${statusColors[friend.status]}`}
                  style={friend.status === "online" ? { boxShadow: "0 0 6px hsl(var(--neon-glow) / 0.6)" } : {}}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-foreground">{friend.name}</p>
                  {friend.starred && <Star size={12} className="fill-primary text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {friend.customStatus || statusLabelMap[friend.status]}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === friend.id ? null : friend.id); }}
                className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground"
                aria-label="Menu"
              >
                <MoreVertical size={18} />
              </button>

              <ContactActionsMenu
                open={menuOpen === friend.id}
                onClose={closeMenu}
                state={{ muted: friend.muted, blocked: friend.blocked, favorite: friend.starred, archived: friend.archived }}
                onMute={() => { void handleMuteMenu(friend.id); }}
                onToggleBlock={() => toggleBlock(friend.id)}
                onToggleFavorite={() => toggleStar(friend.id)}
                onToggleArchive={() => toggleArchive(friend.id)}
                onAssignGroup={() => { setAssignTarget({ id: friend.id, name: friend.name }); closeMenu(); }}
                onClearChat={() => clearChat(friend.id)}
                onReport={() => report(friend.id)}
                onDeleteFriend={() => removeFriend(friend.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <MuteModal open={!!muteTarget} onClose={() => setMuteTarget(null)} onMute={handleMute} />
      <ContactAssignSheet
        open={!!assignTarget}
        chatId={assignTarget?.id || null}
        chatName={assignTarget?.name}
        onClose={() => setAssignTarget(null)}
      />
    </div>
  );
};

export default FriendsList;
