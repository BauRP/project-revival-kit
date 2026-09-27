import { useCallback, useEffect, useState } from "react";

export interface ChatFolder {
  id: string;
  name: string;
  position: number;
  is_system: boolean;
}

const LS_KEY = "trivo-chat-folders-v1";
// Only the system "ВСЕ" tab is seeded by default. Users create their own custom groups.
const DEFAULTS: Omit<ChatFolder, "id">[] = [{ name: "ВСЕ", position: 0, is_system: true }];

const seedLocal = (): ChatFolder[] =>
  DEFAULTS.map((d, i) => ({ ...d, id: `local-${i}-${d.name}` }));

const readLocal = (): ChatFolder[] => {
  try {
    if (typeof localStorage === "undefined") return seedLocal();
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const seeded = seedLocal();
      localStorage.setItem(LS_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as ChatFolder[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : seedLocal();
  } catch {
    return seedLocal();
  }
};

const writeLocal = (folders: ChatFolder[]) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS_KEY, JSON.stringify(folders));
  } catch {
    /* ignore */
  }
};

/**
 * Folder data store — 100% local / serverless.
 * Trivo Chat Elite has no backend account system: folders live in device
 * storage only and never leave the handset.
 */
export const useFolders = () => {
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const local = readLocal();
    setFolders(local);
    setActiveId((prev) => prev ?? local[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addFolder = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const next: ChatFolder = {
        id: `local-${Date.now()}`,
        name: trimmed.toUpperCase(),
        position: folders.length,
        is_system: false,
      };
      const updated = [...folders, next];
      setFolders(updated);
      writeLocal(updated);
    },
    [folders],
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim().toUpperCase();
      if (!trimmed) return;
      const updated = folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f));
      setFolders(updated);
      writeLocal(updated);
    },
    [folders],
  );

  const removeFolder = useCallback(
    async (id: string) => {
      const target = folders.find((f) => f.id === id);
      if (!target || target.is_system) return;
      const updated = folders.filter((f) => f.id !== id);
      setFolders(updated);
      if (activeId === id) setActiveId(updated[0]?.id ?? null);
      writeLocal(updated);
    },
    [folders, activeId],
  );

  return {
    folders,
    activeId,
    setActiveId,
    loading,
    hasSession: false,
    addFolder,
    renameFolder,
    removeFolder,
    reload: load,
  };
};
