import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Clock, Smile, Cat, Coffee, Volleyball, Plane, Lightbulb, Hash, Flag, Delete,
} from "lucide-react";

/**
 * WhatsApp-style custom emoji picker.
 * - Pure black background
 * - 7-column grid, ~45px cells, 32px emoji
 * - Bottom 45px category dock with neon cyan active underline
 * - Top-right backspace (single tap + press-and-hold rapid delete)
 */

type CategoryKey =
  | "recents" | "smileys" | "animals" | "food" | "activity"
  | "travel" | "objects" | "symbols" | "flags";

const CATEGORIES: { key: CategoryKey; label: string; Icon: typeof Smile }[] = [
  { key: "recents",  label: "Recents",          Icon: Clock },
  { key: "smileys",  label: "Smileys & People", Icon: Smile },
  { key: "animals",  label: "Animals & Nature", Icon: Cat },
  { key: "food",     label: "Food & Drink",     Icon: Coffee },
  { key: "activity", label: "Activity",         Icon: Volleyball },
  { key: "travel",   label: "Travel & Places",  Icon: Plane },
  { key: "objects",  label: "Objects",          Icon: Lightbulb },
  { key: "symbols",  label: "Symbols",          Icon: Hash },
  { key: "flags",    label: "Flags",            Icon: Flag },
];

const EMOJIS: Record<Exclude<CategoryKey, "recents">, string[]> = {
  smileys: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👋 🤚 🖐 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 💪 🦾 🦵 🦿 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁 👅 👄 🫦 💋 🩸".split(" "),
  animals: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐽 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🪰 🪲 🪳 🦟 🦗 🕷 🕸 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🦣 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐕‍🦺 🐈 🐈‍⬛ 🪶 🐓 🦃 🦤 🦚 🦜 🦢 🦩 🕊 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿 🦔 🌵 🎄 🌲 🌳 🌴 🪴 🌱 🌿 ☘️ 🍀 🎍 🎋 🍃 🍂 🍁 🍄 🐚 🪨 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻".split(" "),
  food: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🦴 🌭 🍔 🍟 🍕 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕️ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽 🥣 🥡 🥢 🧂".split(" "),
  activity: "⚽️ 🏀 🏈 ⚾️ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳️ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸ 🥌 🎿 ⛷ 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖 🏵 🎗 🎫 🎟 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟ 🎯 🎳 🎮 🎰 🧩".split(" "),
  travel: "🚗 🚕 🚙 🚌 🚎 🏎 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩 💺 🛰 🚀 🛸 🚁 🛶 ⛵️ 🚤 🛥 🛳 ⛴ 🚢 ⚓️ 🪝 ⛽️ 🚧 🚦 🚥 🚏 🗺 🗿 🗽 🗼 🏰 🏯 🏟 🎡 🎢 🎠 ⛲️ ⛱ 🏖 🏝 🏜 🌋 ⛰ 🏔 🗻 🏕 ⛺️ 🛖 🏠 🏡 🏘 🏚 🏗 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛 ⛪️ 🕌 🕍 🛕 🕋 ⛩ 🛤 🛣 🗾 🎑 🏞 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙 🌃 🌌 🌉 🌁".split(" "),
  objects: "⌚️ 📱 📲 💻 ⌨️ 🖥 🖨 🖱 🖲 🕹 🗜 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽 🎞 📞 ☎️ 📟 📠 📺 📻 🎙 🎚 🎛 🧭 ⏱ ⏲ ⏰ 🕰 ⌛️ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯 🪔 🧯 🛢 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒ 🛠 ⛏ 🪚 🔩 ⚙️ 🪤 🧱 ⛓ 🧲 🔫 💣 🧨 🪓 🔪 🗡 ⚔️ 🛡 🚬 ⚰️ 🪦 ⚱️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡 🧹 🪠 🧺 🧻 🚽 🚰 🚿 🛁 🛀 🧼 🪥 🪒 🧽 🪣 🧴 🛎 🔑 🗝 🚪 🪑 🛋 🛏 🛌 🧸 🪆 🖼 🪞 🪟 🛍 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🎊 🎉 🎎 🏮 🎐 🧧 ✉️ 📩 📨 📧 💌 📥 📤 📦 🏷 🪧 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒 🗓 📆 📅 🗑 📇 🗃 🗳 🗄 📋 📁 📂 🗂 🗞 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇 📐 📏 🧮 📌 📍 ✂️ 🖊 🖋 ✒️ 🖌 🖍 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓".split(" "),
  symbols: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚️ 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕️ 🛑 ⛔️ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗️ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯️ 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿️ 🅿️ 🛗 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 ⚧ 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ⏏️ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ 🟰 ♾ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛️ ⬜️ 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄️".split(" "),
  flags: "🏳️ 🏴 🏁 🚩 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️ 🇺🇳 🇺🇸 🇬🇧 🇨🇦 🇦🇺 🇩🇪 🇫🇷 🇪🇸 🇮🇹 🇵🇹 🇧🇷 🇲🇽 🇦🇷 🇨🇱 🇨🇴 🇵🇪 🇻🇪 🇨🇺 🇯🇵 🇨🇳 🇰🇷 🇮🇳 🇷🇺 🇺🇦 🇵🇱 🇨🇿 🇸🇰 🇭🇺 🇷🇴 🇧🇬 🇬🇷 🇹🇷 🇮🇱 🇸🇦 🇦🇪 🇪🇬 🇿🇦 🇳🇬 🇰🇪 🇪🇹 🇲🇦 🇩🇿 🇹🇳 🇮🇩 🇲🇾 🇸🇬 🇹🇭 🇻🇳 🇵🇭 🇵🇰 🇧🇩 🇮🇷 🇮🇶 🇦🇫 🇰🇿 🇺🇿 🇦🇿 🇦🇲 🇬🇪 🇧🇾 🇱🇹 🇱🇻 🇪🇪 🇫🇮 🇸🇪 🇳🇴 🇩🇰 🇮🇸 🇮🇪 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇱🇺 🇲🇨 🇸🇮 🇭🇷 🇧🇦 🇷🇸 🇲🇪 🇲🇰 🇦🇱 🇲🇩 🇨🇾 🇲🇹 🇳🇿".split(" "),
};

const RECENTS_KEY = "trivo.emoji.recents";
const MAX_RECENTS = 28;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

function saveRecents(list: string[]) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS))); } catch { /* ignore */ }
}

interface Props {
  onSelect: (emoji: string) => void;
  onBackspace: () => void;
  height?: number;
}

const CustomEmojiPicker = ({ onSelect, onBackspace, height = 320 }: Props) => {
  const [active, setActive] = useState<CategoryKey>("smileys");
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const scrollRef = useRef<HTMLDivElement>(null);

  const handlePick = useCallback((e: string) => {
    onSelect(e);
    setRecents((prev) => {
      const next = [e, ...prev.filter((x) => x !== e)].slice(0, MAX_RECENTS);
      saveRecents(next);
      return next;
    });
  }, [onSelect]);

  // Press-and-hold rapid backspace
  const holdTimer = useRef<number | null>(null);
  const holdInterval = useRef<number | null>(null);
  const startHold = () => {
    onBackspace();
    holdTimer.current = window.setTimeout(() => {
      holdInterval.current = window.setInterval(() => {
        onBackspace();
        if (navigator.vibrate) navigator.vibrate(8);
      }, 60);
    }, 350);
  };
  const endHold = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (holdInterval.current) { clearInterval(holdInterval.current); holdInterval.current = null; }
  };
  useEffect(() => endHold, []);

  // Isolated category views — only the ACTIVE category is mounted, so tapping
  // a dock icon swaps the whole grid instead of scrolling one long list.
  const activeSection = useMemo(() => {
    const meta = CATEGORIES.find((c) => c.key === active) ?? CATEGORIES[1];
    const items = meta.key === "recents" ? recents : EMOJIS[meta.key as Exclude<CategoryKey, "recents">];
    return { ...meta, items };
  }, [active, recents]);

  const selectCategory = (key: CategoryKey) => {
    setActive(key);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  return (
    <div
      className="trivo-emoji-picker w-full flex flex-col"
      style={{ height, background: "#000000" }}
    >
      {/* Backspace bar (top-right) */}
      <div className="relative flex items-center justify-end px-2" style={{ height: 32 }}>
        <button
          type="button"
          aria-label="Backspace"
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          className="bg-transparent text-white/80 active:text-white p-1 rounded"
        >
          <Delete size={24} />
        </button>
      </div>

      {/* Emoji grid (scrollable) */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-1"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div key={activeSection.key}>
          <div
            className="px-2 pt-2 pb-1 uppercase tracking-wide"
            style={{ color: "#6b7280", fontSize: 12 }}
          >
            {activeSection.label}
          </div>
          {activeSection.items.length === 0 ? (
            <div className="px-3 py-4 text-white/30" style={{ fontSize: 12 }}>
              No emojis yet
            </div>
          ) : (
            <div
              className="grid"
              style={{
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gridAutoRows: "45px",
              }}
            >
              {activeSection.items.map((e, i) => (
                <button
                  key={`${activeSection.key}-${i}-${e}`}
                  type="button"
                  onClick={() => handlePick(e)}
                  className="flex items-center justify-center bg-transparent active:bg-white/10 transition-colors"
                  style={{ height: 45, width: "100%", fontSize: 32, lineHeight: 1 }}
                >
                  <span style={{ fontSize: 32, lineHeight: 1 }}>{e}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom category dock */}
      <div
        className="flex items-stretch border-t border-white/10"
        style={{ height: 45, background: "#000000" }}
      >
        {CATEGORIES.map(({ key, label, Icon }) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              onClick={() => selectCategory(key)}
              className="relative flex-1 flex items-center justify-center bg-transparent"
            >
              <Icon
                size={22}
                color={isActive ? "#00FFFF" : "#9ca3af"}
                strokeWidth={isActive ? 2.25 : 2}
              />
              {isActive && (
                <span
                  className="absolute left-1/2 -translate-x-1/2"
                  style={{
                    bottom: 4,
                    width: 22,
                    height: 2,
                    background: "#00FFFF",
                    borderRadius: 2,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CustomEmojiPicker;
