import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { safeStorage } from "@/lib/safe-storage";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = safeStorage.get("app-theme");
    return (saved as Theme) || "dark";
  });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    safeStorage.set("app-theme", t);
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.remove("light-theme");
      root.classList.remove("light");
      root.classList.add("dark-theme");
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark-theme");
      root.classList.remove("dark");
      root.classList.add("light-theme");
      root.classList.add("light");
      root.style.colorScheme = "light";
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
};
