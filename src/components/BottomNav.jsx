import { NavLink } from "react-router-dom";
import { Timer, Building2, Presentation, Users, MoreHorizontal } from "lucide-react";

// Glassmorphic bottom tab bar for touch / small screens (thumb-reachable,
// one-handed). Shown only on coarse-pointer devices below `lg` (see index.css —
// it replaces the top hamburger there); the desktop nav and the narrow-desktop
// hamburger are untouched. Four primary destinations + a "More" tab that opens
// the existing drawer (Time tracker, Quick timer, Settings, theme, Sign out).

const TABS = [
  { to: "/pomodoro", label: "Timer", Icon: Timer, badge: true },
  { to: "/office", label: "Office", Icon: Building2 },
  { to: "/whiteboards", label: "Boards", Icon: Presentation },
  { to: "/team", label: "Org", Icon: Users },
];

export default function BottomNav({ dark, hasTeamSessions, onMore }) {
  const item = "relative flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors";
  const idle = dark ? "text-slate-400" : "text-slate-500";

  return (
    <nav
      aria-label="Primary"
      className={`ql-bottom-nav fixed inset-x-0 bottom-0 z-[70] border-t backdrop-blur-xl ${
        dark
          ? "bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)] border-[var(--color-border)]"
          : "bg-white/75 border-slate-200"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch justify-around h-16 max-w-lg mx-auto">
        {TABS.map(({ to, label, Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `${item} ${isActive ? "text-[var(--color-accent)]" : idle}`}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0 h-0.5 w-8 rounded-full bg-[var(--color-accent)]" />
                )}
                <span className="relative">
                  <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.4 : 2} />
                  {badge && hasTeamSessions && (
                    <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  )}
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className={`${item} ${idle}`} aria-label="More">
          <MoreHorizontal className="w-[22px] h-[22px]" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
