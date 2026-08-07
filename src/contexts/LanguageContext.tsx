import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";
import { translations, Language, TranslationKey } from "@/i18n/translations";
import { safeStorage } from "@/lib/safe-storage";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLang] = useState<Language>(() => {
    const saved = safeStorage.get("app-language");
    return (saved as Language) || "en";
  });

  const setLanguage = useCallback((lang: Language) => {
    setLang(lang);
    safeStorage.set("app-language", lang);
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[language]?.[key] ?? translations["en"][key] ?? key;
    },
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
};
