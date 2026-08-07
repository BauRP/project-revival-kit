import { AnimatePresence, motion } from "framer-motion";
import { Check, FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useFolders } from "@/hooks/useFolders";
import { getFoldersForChat, setChatFolders } from "@/lib/folder-assignments";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  chatId: string | null;
  chatName?: string;
  onClose: () => void;
}

const ContactAssignSheet = ({ open, chatId, chatName, onClose }: Props) => {
  const { folders, addFolder } = useFolders();
  const customFolders = folders.filter((f) => !f.is_system);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !chatId) return;
    void getFoldersForChat(chatId).then((ids) => setSelected(new Set(ids)));
  }, [open, chatId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!chatId) return;
    await setChatFolders(chatId, Array.from(selected));
    toast({ title: "Группы обновлены" });
    onClose();
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) { setCreating(false); return; }
    await addFolder(trimmed);
    setNewName("");
    setCreating(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-2xl border border-[#00FFFF]/30 bg-black p-5 space-y-4"
            style={{ boxShadow: "0 -10px 40px rgba(0,255,255,0.15)" }}
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-[#00FFFF] font-bold">Группы</p>
                <p className="text-sm text-foreground truncate">{chatName || "Контакт"}</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground">
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[40vh] overflow-y-auto scrollbar-hide space-y-1.5">
              {customFolders.length === 0 && !creating && (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  Нет групп. Создайте первую ниже.
                </p>
              )}
              {customFolders.map((f) => {
                const checked = selected.has(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggle(f.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      checked
                        ? "border-[#00FFFF] bg-[#00FFFF]/10 text-[#00FFFF]"
                        : "border-white/10 bg-black hover:bg-white/5 text-foreground"
                    }`}
                  >
                    <span className="text-sm font-semibold uppercase tracking-wide">{f.name}</span>
                    {checked && <Check size={16} />}
                  </button>
                );
              })}

              {creating ? (
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={handleCreate}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setNewName(""); setCreating(false); }
                  }}
                  placeholder="ИМЯ ГРУППЫ"
                  maxLength={16}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#00FFFF]/40 bg-black text-sm text-foreground uppercase tracking-wide outline-none focus:border-[#00FFFF]"
                />
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-[#00FFFF]/40 text-[#00FFFF] hover:bg-[#00FFFF]/5 transition-colors"
                >
                  <FolderPlus size={16} />
                  <span className="text-sm font-semibold">Новая группа</span>
                </button>
              )}
            </div>

            <button
              onClick={handleSave}
              className="w-full py-2.5 rounded-xl bg-[#00FFFF] text-black font-bold uppercase tracking-wide text-sm"
              style={{ boxShadow: "0 0 16px rgba(0,255,255,0.5)" }}
            >
              Сохранить
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ContactAssignSheet;
