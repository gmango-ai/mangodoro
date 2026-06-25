import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "./ThemeContext";
import ProfileCard from "../components/profile/ProfileCard";

// Click-anywhere profile popover. Any identity (a name, avatar, or @mention)
// calls openProfile(userId, anchorRect) to pop a card near it; the card links
// to the full /u/:id page. One floating card at a time, closes on outside
// click / Escape.
const ProfileCtx = createContext(null);
export const useProfileCard = () => useContext(ProfileCtx) || { openProfile: () => {} };

const CARD_W = 256;
const CARD_H = 240;

export function ProfileProvider({ children }) {
  const [open, setOpen] = useState(null); // { userId, rect }
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const ref = useRef(null);

  const openProfile = useCallback((userId, rect) => { if (userId) setOpen({ userId, rect: rect || null }); }, []);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Position below-left of the anchor, clamped to the viewport.
  let pos = { left: 16, top: 16 };
  if (open?.rect) {
    let left = Math.min(open.rect.left, window.innerWidth - CARD_W - 8);
    let top = open.rect.bottom + 6;
    if (top + CARD_H > window.innerHeight) top = Math.max(8, open.rect.top - CARD_H - 6);
    pos = { left: Math.max(8, left), top };
  }

  return (
    <ProfileCtx.Provider value={{ openProfile, close }}>
      {children}
      {open && (
        <div
          ref={ref}
          className="fixed z-[9997] rounded-2xl border shadow-2xl"
          style={{ left: pos.left, top: pos.top, background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
        >
          <ProfileCard
            userId={open.userId}
            onOpenFull={() => { const id = open.userId; close(); navigate(`/u/${id}`); }}
          />
        </div>
      )}
    </ProfileCtx.Provider>
  );
}
