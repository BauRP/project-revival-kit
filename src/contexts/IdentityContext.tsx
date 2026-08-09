import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { getOrCreateIdentity, getKeyFingerprint, type IdentityKeys } from "@/lib/crypto";
import { getOrCreateUserId } from "@/lib/identity";
import { publishPublicKeys } from "@/lib/local-peer-cache";
import { nukeAllData } from "@/lib/storage";
import { safeStorage } from "@/lib/safe-storage";

interface IdentityContextType {
  identity: IdentityKeys | null;
  userId: string;
  fingerprint: string;
  isLoading: boolean;
  stealthMode: boolean;
  toggleStealth: () => void;
  deleteAccount: () => Promise<void>;
}

const IdentityContext = createContext<IdentityContextType | undefined>(undefined);

export const IdentityProvider = ({ children }: { children: ReactNode }) => {
  const [identity, setIdentity] = useState<IdentityKeys | null>(null);
  const [userId, setUserId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [stealthMode, setStealthMode] = useState(
    () => safeStorage.get("trivo-stealth") === "true",
  );

  useEffect(() => {
    let cancelled = false;
    let initTimer: number | undefined;
    
    const initIdentity = async () => {
      try {
        const keys = await getOrCreateIdentity();
        const nextUserId = await getOrCreateUserId();
        if (cancelled) return;

        setIdentity(keys);
        setUserId(nextUserId);
        setIsLoading(false);

        // Cache public keys locally after identity generation completes.
        try {
          publishPublicKeys(nextUserId, keys.signing.publicKey, keys.exchange.publicKey);
        } catch (error) {
          console.warn("[trivo] public-key cache unavailable:", error);
        }

      } catch (error) {
        console.error("Критическая ошибка инициализации личности:", error);
        if (!cancelled) setIsLoading(false);
      }
    };

    const paintFrame = window.requestAnimationFrame(() => {
      initTimer = window.setTimeout(() => {
        void initIdentity();
      }, 50);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(paintFrame);
      if (initTimer !== undefined) window.clearTimeout(initTimer);
    };
  }, []);

  useEffect(() => {
    safeStorage.set("trivo-stealth", String(stealthMode));
  }, [stealthMode]);

  const toggleStealth = useCallback(() => setStealthMode((p) => !p), []);

  const deleteAccount = useCallback(async () => {
    // Полная очистка перед удалением
    await nukeAllData();
    try {
      localStorage.clear();
    } catch {
      safeStorage.remove("trivo-stealth");
    }
    window.location.reload();
  }, []);

  const fingerprint = identity ? getKeyFingerprint(identity.signing.publicKey) : "";

  return (
    <IdentityContext.Provider
      value={{ identity, userId, fingerprint, isLoading, stealthMode, toggleStealth, deleteAccount }}
    >
      {children}
    </IdentityContext.Provider>
  );
};

export const useIdentity = () => {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used within IdentityProvider");
  return ctx;
};
