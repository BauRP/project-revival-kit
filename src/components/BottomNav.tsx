import { MessageCircle, UserPlus, Users, User, Shield } from "lucide-react";
import { motion } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import { TranslationKey } from "@/i18n/translations";
import { LAYOUT_CONFIG } from "@/lib/layout-metrics";

type Tab = "chats" | "add-friend" | "friends" | "security" | "profile";

interface BottomNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const tabs: { id: Tab; labelKey: TranslationKey; icon: typeof MessageCircle }[] = [
  { id: "chats", labelKey: "chats", icon: MessageCircle },
  { id: "add-friend", labelKey: "add", icon: UserPlus },
  { id: "friends", labelKey: "friends", icon: Users },
  { id: "security", labelKey: "security", icon: Shield },
  { id: "profile", labelKey: "profile", icon: User },
];

/**
 * Bottom-bar labels must never wrap or ellipsize — long words (e.g. the
 * Russian "Безопасность") are clipped to a compact 7-character stem so all
 * five tabs stay on one line at any font scale.
 */
const navLabel = (label: string) => (label.length > 8 ? label.slice(0, 7) : label);

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  const { t } = useLanguage();

  return (
    <nav
      className="!fixed !bottom-0 left-0 right-0 z-[100] w-full"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
      }}
    >
      <div
        className="glass-panel px-2 rounded-none rounded-t-2xl neon-border border-b-0 overflow-hidden"
        style={{
          height: `calc(${LAYOUT_CONFIG.BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
          paddingTop: 0,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex h-full items-stretch justify-around">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className="relative flex flex-1 min-w-0 flex-col items-center justify-center gap-1 px-1 py-0 transition-colors"
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute top-0 left-3 right-3 h-0.5 rounded-full"
                    style={{
                      background: "hsl(var(--neon-glow))",
                      boxShadow:
                        "0 0 8px hsl(var(--neon-glow) / 0.6), 0 0 20px hsl(var(--neon-glow) / 0.3)",
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <div
                  className={`flex h-[22px] items-center justify-center transition-all ${isActive ? "drop-shadow-[0_0_6px_hsl(var(--neon-glow)/0.5)]" : ""}`}
                >
                  <Icon
                    size={22}
                    className={`transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
                  />
                </div>
                <span
                  className={`text-[10px] leading-none font-medium transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {navLabel(t(tab.labelKey))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;
