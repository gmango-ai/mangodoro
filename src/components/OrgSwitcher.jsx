import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTeam } from "../context/TeamContext";
import { useMessages } from "../context/MessagesContext";
import { useTheme } from "../context/ThemeContext";
import { Check, ChevronDown, Star, Plus } from "lucide-react";

// Small unread-count pill shown next to an org (per-org messaging unread).
function UnreadPill({ count }) {
  if (!count) return null;
  return (
    <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold inline-flex items-center justify-center">
      {count > 9 ? "9+" : count}
    </span>
  );
}

// Header chip + dropdown for picking which org the app is operating
// against. Only renders when the user is in 2+ orgs — single-org users
// don't need a switcher and the chip just becomes visual noise.
//
// The star toggles ql_default_team: the org the app starts in next
// time the user opens it. Switching (no star) updates ql_active_team
// for this session only.
export default function OrgSwitcher({ variant = "header" }) {
  const { teams, activeTeam, activeTeamId, switchTeam, defaultTeamId, setDefaultTeam } = useTeam();
  const { unreadByOrg } = useMessages();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function down(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function key(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (!teams || teams.length < 2) return null;
  if (!activeTeam) return null;

  const orgUnread = (id) => (unreadByOrg && unreadByOrg.get ? unreadByOrg.get(id) : 0) || 0;
  // Unread sitting in orgs the user isn't currently looking at — a hint to switch.
  const otherOrgsUnread = teams.reduce((n, t) => (t.id === activeTeamId ? n : n + orgUnread(t.id)), 0);

  function handleSwitch(teamId) {
    if (teamId !== activeTeamId) switchTeam(teamId);
    setOpen(false);
  }

  function handleToggleDefault(teamId, e) {
    e.stopPropagation();
    setDefaultTeam(defaultTeamId === teamId ? null : teamId);
  }

  const chipCls = `flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full transition-colors ${
    dark ? "hover:bg-[var(--color-surface-raised)]" : "hover:bg-slate-100"
  }`;

  const menuCls = `absolute left-0 top-full mt-1.5 min-w-[240px] rounded-xl border shadow-lg overflow-hidden z-50 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
  }`;

  const itemBase = "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors";

  return (
    <div ref={ref} className={`relative ${variant === "header" ? "shrink-0" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={chipCls}
        title={activeTeam.name}
      >
        <TeamIcon team={activeTeam} size={22} />
        <span className={`text-sm font-semibold truncate max-w-[140px] ${dark ? "text-slate-100" : "text-slate-800"}`}>
          {activeTeam.name}
        </span>
        {defaultTeamId === activeTeamId && (
          <Star className="w-3 h-3 text-[var(--color-accent)] fill-current" aria-label="Default org" />
        )}
        {otherOrgsUnread > 0 && <UnreadPill count={otherOrgsUnread} />}
        <ChevronDown className={`w-3.5 h-3.5 ${dark ? "text-slate-500" : "text-slate-400"}`} aria-hidden />
      </button>

      {open && (
        <div role="menu" className={menuCls}>
          <div className={`px-3 py-2 text-[10px] uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Your orgs
          </div>
          {teams.map((t) => {
            const isActive = t.id === activeTeamId;
            const isDefault = defaultTeamId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => handleSwitch(t.id)}
                className={`${itemBase} ${
                  dark
                    ? isActive ? "bg-[var(--color-surface-raised)] text-slate-100" : "text-slate-200 hover:bg-slate-700/40"
                    : isActive ? "bg-slate-100 text-slate-800" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <TeamIcon team={t} size={20} />
                <span className="flex-1 truncate text-left">{t.name}</span>
                <UnreadPill count={orgUnread(t.id)} />
                {isActive && <Check className="w-3.5 h-3.5 text-[var(--color-accent)]" aria-hidden />}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleToggleDefault(t.id, e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleToggleDefault(t.id, e);
                    }
                  }}
                  title={isDefault ? "Remove as default" : "Set as default"}
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    isDefault
                      ? "text-[var(--color-accent)]"
                      : dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${isDefault ? "fill-current" : ""}`} />
                </span>
              </button>
            );
          })}

          <div className={`my-1 h-px ${dark ? "bg-slate-700/60" : "bg-slate-200"}`} />

          <NavLink
            to="/team"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={`${itemBase} ${
              dark ? "text-slate-300 hover:bg-slate-700/40" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Plus className="w-4 h-4 opacity-70" />
            Join or create
          </NavLink>
        </div>
      )}
    </div>
  );
}

function TeamIcon({ team, size = 22 }) {
  const px = `${size}px`;
  const initial = (team?.name || "?")[0].toUpperCase();
  if (team?.icon_url) {
    return (
      <img
        src={team.icon_url}
        alt=""
        style={{ width: px, height: px }}
        className="rounded-md object-cover shrink-0"
      />
    );
  }
  return (
    <span
      style={{
        width: px,
        height: px,
        background: team?.color || "#14b8a6",
        fontSize: Math.max(10, Math.round(size / 2.4)),
      }}
      className="rounded-md flex items-center justify-center font-bold text-white shrink-0"
    >
      {initial}
    </span>
  );
}
