import { Settings, ChevronRight, Camera, X, Check, Pencil } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import SettingsPage from "./SettingsPage";
import DefaultAvatar from "./DefaultAvatar";
import { useLanguage } from "@/contexts/LanguageContext";
import { useIdentity } from "@/contexts/IdentityContext";
import {
  loadMyProfile,
  saveMyProfile,
  republishMyProfile,
  type ProfileStatus,
} from "@/lib/profile";

const ProfilePage = () => {
  const { userId } = useIdentity();
  const { t } = useLanguage();

  const [avatar, setAvatar] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Name editing is explicit: the text itself is inert, only the pencil opens
  // the editor, and confirm/cancel both close it.
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [status, setStatus] = useState<ProfileStatus>("online");
  // Saved value (source of truth) vs. the in-progress draft in the input.
  const [customStatus, setCustomStatus] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  // Controls the inline custom-status editor (input + confirm + cancel).
  const [isEditingCustomStatus, setIsEditingCustomStatus] = useState(false);
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rehydrate from persistent storage on every mount (tab switches remount this
  // component, so the saved custom status must always come back).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const profile = await loadMyProfile(userId);
      if (cancelled) return;
      setAvatar(profile.avatar);
      setName(profile.name);
      setDraftName(profile.name);
      setStatus(profile.status);
      setCustomStatus(profile.customStatus);
      setDraftStatus(profile.customStatus);
      setReady(true);
      // Re-announce so contacts that came online meanwhile get the latest copy.
      void republishMyProfile(userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persist = async (
    patch: Partial<{
      name: string;
      avatar: string | null;
      status: ProfileStatus;
      customStatus: string;
    }>,
  ) => {
    if (!userId || !ready) return;
    await saveMyProfile(userId, patch);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setAvatar(dataUrl);
      void persist({ avatar: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeAvatar = () => {
    setAvatar(null);
    void persist({ avatar: null });
  };

  const startEditName = () => {
    setDraftName(name);
    setIsEditingName(true);
  };

  const confirmName = () => {
    const value = draftName.trim();
    setName(value);
    setIsEditingName(false);
    void persist({ name: value });
  };

  const cancelName = () => {
    setDraftName(name);
    setIsEditingName(false);
  };

  const selectStatus = (next: ProfileStatus) => {
    setStatus(next);
    if (next !== "custom") {
      setIsEditingCustomStatus(false);
      void persist({ status: next });
    } else {
      // Tapping "Custom status" always (re)opens the editor pre-filled with
      // the currently saved value so it can be edited or cleared.
      setDraftStatus(customStatus);
      setIsEditingCustomStatus(true);
      void persist({ status: next, customStatus });
    }
  };

  const confirmCustomStatus = () => {
    const value = draftStatus.trim();
    setCustomStatus(value);
    setIsEditingCustomStatus(false);
    void persist({ status: "custom", customStatus: value });
  };

  const cancelCustomStatus = () => {
    // Discard unsaved edits and close the editor.
    setDraftStatus(customStatus);
    setIsEditingCustomStatus(false);
  };

  const statusOptions: { id: ProfileStatus; label: string; color: string }[] = [
    { id: "online", label: t("online"), color: "bg-primary" },
    { id: "away", label: t("away"), color: "bg-yellow-500" },
    { id: "dnd", label: t("doNotDisturb"), color: "bg-destructive" },
    { id: "offline", label: t("offline"), color: "bg-muted-foreground/40" },
    { id: "custom", label: t("custom"), color: "bg-blue-400" },
  ];

  if (showSettings) {
    return <SettingsPage onBack={() => setShowSettings(false)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="header-safe-zone px-5 pb-2 shrink-0">
        <div className="header-bar-56 flex items-center justify-between">
          <h1 className="text-2xl font-bold gradient-text">{t("profile")}</h1>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-xl hover:bg-secondary/50 text-muted-foreground transition-colors"
            aria-label={t("settings")}
          >
            <Settings size={22} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {/* Avatar */}
        <div className="flex flex-col items-center px-5 pb-6">
          <div className="relative group">
            <DefaultAvatar src={avatar} size={112} />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 rounded-full bg-background/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
              aria-label={t("profile")}
            >
              <Camera size={24} className="text-foreground" />
            </button>
            {avatar && (
              <button
                onClick={removeAvatar}
                className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Name row: the label itself is NOT tappable. A persistent pencil
              sits beside it and never gets pushed off-screen thanks to the
              min-w-0 / flex-shrink pairing on the text. */}
          <div className="mt-4 w-full px-6 flex justify-center">
            {isEditingName ? (
              // The input stays dead-centre; the confirm/cancel buttons are
              // absolutely positioned beside it so they add no layout width
              // and therefore cannot shift the centred field.
              <div className="relative inline-flex items-center justify-center">
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value.slice(0, 12))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmName();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelName();
                    }
                  }}
                  maxLength={12}
                  size={12}
                  className="w-[9.5rem] text-xl font-bold text-foreground bg-transparent text-center border-b border-primary/40 outline-none focus:ring-0"
                  placeholder={t("yourName")}
                />
                <div className="absolute left-full ml-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={confirmName}
                    aria-label={t("confirmStatus")}
                    className="w-8 h-8 shrink-0 rounded-xl flex items-center justify-center bg-primary/15 text-primary neon-border"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={cancelName}
                    aria-label={t("cancel")}
                    className="w-8 h-8 shrink-0 rounded-xl flex items-center justify-center bg-secondary/60 text-muted-foreground"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            ) : (
              // Same trick for the read-only state: the pencil is absolutely
              // positioned to the right of the label, so the name text itself
              // remains perfectly centred beneath the avatar.
              <div className="relative inline-flex max-w-[70%] items-center justify-center">
                <span className="truncate text-xl font-bold text-foreground">
                  {name || t("yourName")}
                </span>
                <button
                  type="button"
                  onClick={startEditName}
                  aria-label={t("yourName")}
                  className="absolute left-full ml-1.5 w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-secondary/50 transition-colors"
                >
                  <Pencil size={15} />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${statusOptions.find((s) => s.id === status)?.color}`}
              style={
                status === "online" ? { boxShadow: "0 0 6px hsl(var(--neon-glow) / 0.6)" } : {}
              }
            />
            <span className="text-sm text-muted-foreground">
              {status === "custom"
                ? customStatus || t("setStatus")
                : statusOptions.find((s) => s.id === status)?.label}
            </span>
          </div>
        </div>

        {/* Status selector */}
        <div className="px-5 space-y-1.5 pb-6">
          <p className="text-xs text-muted-foreground font-medium mb-2 px-1">{t("status")}</p>
          {statusOptions.map((s) => (
            <button
              key={s.id}
              onClick={() => selectStatus(s.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                status === s.id ? "glass-panel neon-border" : "glass-panel-sm hover:neon-border"
              }`}
            >
              <div
                className={`w-3 h-3 rounded-full ${s.color}`}
                style={
                  s.id === "online" && status === s.id
                    ? { boxShadow: "0 0 6px hsl(var(--neon-glow) / 0.6)" }
                    : {}
                }
              />
              <span className="text-sm text-foreground flex-1 text-left">{s.label}</span>
              {status === s.id && <ChevronRight size={16} className="text-primary" />}
            </button>
          ))}

          {status === "custom" && isEditingCustomStatus && (
            <div className="flex items-center gap-2 mt-2">
              <input
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    confirmCustomStatus();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelCustomStatus();
                  }
                }}
                placeholder={t("whatsOnYourMind")}
                className="glass-input flex-1 text-sm"
                maxLength={50}
              />
              <button
                type="button"
                onClick={confirmCustomStatus}
                aria-label={t("confirmStatus")}
                className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-primary/15 text-primary neon-border  transition-opacity"
              >
                <Check size={18} />
              </button>
              <button
                type="button"
                onClick={cancelCustomStatus}
                aria-label={t("cancel")}
                className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-secondary/60 text-muted-foreground  transition-opacity"
              >
                <X size={18} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
