import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { followUser, unfollowUser, listFollows } from "../lib/notifications";

// "Notify me when they start focusing" toggle for a teammate. Self-contained:
// loads my follow set once (cached), toggles via the notification_follows
// helpers. The follow_focus DB trigger reads these to ping me when the person
// starts a session. Hidden for myself / unknown users.

let _cache = null; // Set<targetUserId> of who I follow (focus_start)
async function ensureFollows() {
  if (_cache) return _cache;
  _cache = new Set(await listFollows());
  return _cache;
}

export default function FollowButton({ userId, className = "" }) {
  const { session } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const myId = session?.user?.id;
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    let on = true;
    ensureFollows().then((s) => { if (on) setFollowing(s.has(userId)); });
    return () => { on = false; };
  }, [userId]);

  if (!userId || !myId || userId === myId) return null;

  const toggle = async (e) => {
    e?.stopPropagation?.();
    const next = !following;
    const { error } = next
      ? await followUser(myId, userId)
      : await unfollowUser(userId);
    if (error) return;
    setFollowing(next);
    const s = await ensureFollows();
    if (next) s.add(userId);
    else s.delete(userId);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={following}
      title={following ? "Following — you'll be notified when they start focusing" : "Notify me when they start focusing"}
      className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
        following ? "text-[var(--color-accent)]" : dark ? "text-slate-500 hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"
      } ${className}`}
    >
      <Bell className="w-4 h-4" fill={following ? "currentColor" : "none"} />
    </button>
  );
}
