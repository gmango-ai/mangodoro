import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { useTeam } from "../context/TeamContext";
import { Crown, ShieldCheck, Trash2, Pencil, X, Clock, ChevronDown, ChevronRight } from "lucide-react";
import ConfirmRow from "./ConfirmRow";

// Inline team chip strip — minimal so it fits next to a participant
// name without inflating row height. Mirror MemberIdentity's chip
// style but stripped down; both should converge on the same look.
function TeamChips({ teams, dark, max = 3 }) {
  if (!teams || teams.length === 0) return null;
  const shown = teams.slice(0, max);
  const overflow = teams.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 ml-1">
      {shown.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{
            background: `${t.color}22`,
            color: dark ? "#fff" : t.color,
            border: `1px solid ${t.color}55`,
          }}
          title={t.role === "lead" ? `${t.name} (lead)` : t.name}
        >
          <span className="w-1 h-1 rounded-full" style={{ background: t.color }} />
          {t.name}
        </span>
      ))}
      {overflow > 0 && (
        <span className={`text-[10px] font-semibold ${dark ? "text-slate-400" : "text-slate-500"}`}>
          +{overflow}
        </span>
      )}
    </span>
  );
}

const PRESENCE_INFO = {
  active:     { label: "Active",       light: "bg-emerald-500", dark: "bg-emerald-400" },
  available:  { label: "Available",    light: "bg-sky-500",     dark: "bg-sky-400"     },
  heads_down: { label: "Heads-down",   light: "bg-violet-500",  dark: "bg-violet-400"  },
  in_meeting: { label: "In a meeting", light: "bg-rose-500",    dark: "bg-rose-400"    },
  away:       { label: "Away",         light: "bg-amber-500",   dark: "bg-amber-400"   },
};

function presenceOf(p) {
  return PRESENCE_INFO[p?.presence_state] || PRESENCE_INFO.active;
}

function relativeTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const COLLAPSED_KEY = "ql_sync_participants_collapsed";

function Avatar({ participant, size = 36, dark, isLeader }) {
  const initial = (participant.display_name || "?")[0].toUpperCase();
  const url = participant.avatar_url;
  const px = `${size}px`;
  const fontSize = Math.max(10, Math.round(size / 2.5));
  return (
    <div
      className={`relative rounded-full overflow-hidden border-2 shrink-0 ${
        isLeader
          ? "border-[var(--color-accent)]"
          : dark ? "border-[var(--color-border)]" : "border-slate-300"
      }`}
      style={{ width: px, height: px }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span
          className={`flex items-center justify-center w-full h-full font-bold ${
            isLeader
              ? "bg-[var(--color-accent-light-hover)] text-[var(--color-accent)]"
              : dark ? "bg-[var(--color-surface-raised)] text-slate-400" : "bg-slate-100 text-slate-500"
          }`}
          style={{ fontSize }}
        >
          {initial}
        </span>
      )}
    </div>
  );
}

export default function SyncParticipantList({
  participants,
  leaderId,
  controllerId,
  presenceMap,
  currentUserId,
  onTransferLeader,
  onKickParticipant,
  onEditMyStatus,
  defaultExpanded = false,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  // Surfaces that lead with participants (the redesigned pomodoro
  // surface) pass defaultExpanded; otherwise the saved localStorage
  // preference wins, falling back to collapsed first-time so the
  // avatar strip alone is the initial impression.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      if (stored !== null) return stored !== "false";
      return !defaultExpanded;
    } catch {
      return !defaultExpanded;
    }
  });
  const [selectedId, setSelectedId] = useState(null);
  const [confirming, setConfirming] = useState(null); // "transfer" | "kick" | null

  useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "true" : "false"); } catch { /* ignore */ } }, [collapsed]);

  // Clear selection if that participant leaves the session.
  useEffect(() => {
    if (selectedId && !participants?.some((p) => p.user_id === selectedId)) {
      setSelectedId(null);
      setConfirming(null);
    }
  }, [participants, selectedId]);

  // Reset confirmation when switching between participants.
  useEffect(() => { setConfirming(null); }, [selectedId]);

  if (!participants?.length) return null;

  const viewerIsLeader = currentUserId && currentUserId === leaderId;
  const allowMakeLeader = true;
  const selected = participants.find((p) => p.user_id === selectedId) || null;

  function toggleSelect(userId) {
    setSelectedId((cur) => (cur === userId ? null : userId));
  }

  return (
    <div className="space-y-1.5">
      {/* One header that toggles between avatars-strip (collapsed) and
          full list (expanded). Collapsed is the default — the strip
          already tells you who's around. */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={`w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider mb-1 transition-colors ${
          dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
        }`}
        aria-expanded={!collapsed}
      >
        <span className="inline-flex items-center gap-1">
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          In session · {participants.length}
        </span>
      </button>

      {collapsed ? (
        <CompactView
          participants={participants}
          leaderId={leaderId}
          controllerId={controllerId}
          presenceMap={presenceMap}
          currentUserId={currentUserId}
          selectedId={selectedId}
          onSelect={toggleSelect}
          dark={dark}
        />
      ) : (
        <ListView
          participants={participants}
          leaderId={leaderId}
          controllerId={controllerId}
          presenceMap={presenceMap}
          currentUserId={currentUserId}
          selectedId={selectedId}
          onSelect={toggleSelect}
          dark={dark}
        />
      )}

      {/* Click-through detail card: full status, joined-at, actions */}
      {selected && (
        <ParticipantDetail
          participant={selected}
          dark={dark}
          isLeader={selected.user_id === leaderId}
          isController={selected.user_id === controllerId}
          isSelf={selected.user_id === currentUserId}
          isOnline={presenceMap?.[selected.user_id] ?? false}
          viewerIsLeader={viewerIsLeader}
          allowMakeLeader={allowMakeLeader}
          confirming={confirming}
          setConfirming={setConfirming}
          onTransferLeader={onTransferLeader}
          onKickParticipant={onKickParticipant}
          onEditMyStatus={onEditMyStatus}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function ListView({ participants, leaderId, controllerId, presenceMap, currentUserId, selectedId, onSelect, dark }) {
  const { teamsByUserId } = useTeam();
  return (
    <ul className="max-h-72 overflow-y-auto -mx-0.5 px-0.5 space-y-1">
      {participants.map((p) => {
        const isLeader = p.user_id === leaderId;
        const isController = p.user_id === controllerId;
        const isSelf = p.user_id === currentUserId;
        const isOnline = presenceMap?.[p.user_id] ?? false;
        const presence = presenceOf(p);
        const dotCls = isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400";
        const isSelected = selectedId === p.user_id;
        return (
          <li key={p.user_id}>
            <button
              type="button"
              onClick={() => onSelect(p.user_id)}
              aria-pressed={isSelected}
              className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isSelected
                  ? "bg-[var(--color-accent-light)] ring-1 ring-[var(--color-accent)]"
                  : dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50 hover:bg-slate-100"
              }`}
            >
              <div className="relative">
                <Avatar participant={p} dark={dark} isLeader={isLeader} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
                    dark ? "border-slate-900" : "border-white"
                  } ${dotCls}`}
                  title={isOnline ? presence.label : "Offline"}
                />
                {isLeader && (
                  <span className={`absolute -top-1 -right-1 rounded-full p-0.5 ${dark ? "bg-[var(--color-surface)]" : "bg-white"}`}>
                    <Crown className={`w-2.5 h-2.5 ${dark ? "text-amber-300" : "text-amber-500"}`} fill="currentColor" />
                  </span>
                )}
                {isController && !isLeader && (
                  <span className={`absolute -top-1 -left-1 rounded-full p-0.5 ${dark ? "bg-[var(--color-surface)]" : "bg-white"}`}>
                    <Clock className="w-2.5 h-2.5 text-[var(--color-accent)]" />
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"} flex items-center flex-wrap gap-y-0.5`}>
                  <span className="truncate">
                    {isSelf ? `${p.display_name || "You"} (you)` : (p.display_name || "Member")}
                  </span>
                  {isController && <span className="ml-1 text-[10px] text-[var(--color-accent)]">⏱</span>}
                  <TeamChips teams={teamsByUserId?.get(p.user_id)} dark={dark} />
                </p>
                <p className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {p.status?.trim()
                    ? p.status
                    : <span className="italic opacity-70">{presence.label}{!isOnline ? " · Offline" : ""}</span>}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CompactView({ participants, leaderId, controllerId, presenceMap, currentUserId, selectedId, onSelect, dark }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {participants.map((p) => {
        const isLeader = p.user_id === leaderId;
        const isController = p.user_id === controllerId;
        const isSelf = p.user_id === currentUserId;
        const isOnline = presenceMap?.[p.user_id] ?? false;
        const presence = presenceOf(p);
        const dotCls = isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400";
        const isSelected = selectedId === p.user_id;
        return (
          <button
            type="button"
            key={p.user_id}
            onClick={() => onSelect(p.user_id)}
            aria-pressed={isSelected}
            title={`${isSelf ? "You" : (p.display_name || "Member")}${isController ? " · Controls timer" : ""}${p.status?.trim() ? ` — ${p.status}` : ""}`}
            className={`relative rounded-full ${isSelected ? "ring-2 ring-offset-1 ring-[var(--color-accent)] " + (dark ? "ring-offset-slate-900" : "ring-offset-white") : ""}`}
          >
            <Avatar participant={p} size={32} dark={dark} isLeader={isLeader} />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
                dark ? "border-slate-900" : "border-white"
              } ${dotCls}`}
            />
            {isLeader && (
              <span className={`absolute -top-1 -right-1 rounded-full p-0.5 ${dark ? "bg-[var(--color-surface)]" : "bg-white"}`}>
                <Crown className={`w-2.5 h-2.5 ${dark ? "text-amber-300" : "text-amber-500"}`} fill="currentColor" />
              </span>
            )}
            {isController && !isLeader && (
              <span className={`absolute -top-1 -left-1 rounded-full p-0.5 ${dark ? "bg-[var(--color-surface)]" : "bg-white"}`}>
                <Clock className="w-2.5 h-2.5 text-[var(--color-accent)]" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ParticipantDetail({
  participant: p, dark, isLeader, isController, isSelf, isOnline, viewerIsLeader, allowMakeLeader,
  confirming, setConfirming,
  onTransferLeader, onKickParticipant, onEditMyStatus, onClose,
}) {
  const { teamsByUserId } = useTeam();
  const presence = presenceOf(p);
  const userTeams = teamsByUserId?.get(p.user_id) || [];

  return (
    <div
      className={`rounded-lg border p-3 ${
        dark
          ? "bg-[var(--color-surface)] border-[var(--color-accent)] shadow-lg"
          : "bg-white border-[var(--color-accent)] shadow-lg"
      }`}
    >
      <div className="flex items-start gap-3">
        <Avatar participant={p} size={48} dark={dark} isLeader={isLeader} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {isSelf ? `${p.display_name || "You"} (you)` : (p.display_name || "Member")}
            </p>
            {isLeader && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700"
              }`}>
                <Crown className="w-2.5 h-2.5" fill="currentColor" />
                Leader
              </span>
            )}
            {isController && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
              }`}>
                <Clock className="w-2.5 h-2.5" />
                Controls timer
              </span>
            )}
          </div>
          <div className={`flex items-center gap-1.5 text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400"}`} />
            <span>{presence.label}{!isOnline ? " · Offline" : ""}</span>
          </div>
          {p.joined_at && (
            <div className={`flex items-center gap-1 text-[11px] mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              <Clock className="w-3 h-3" />
              <span>Joined {relativeTime(p.joined_at)}</span>
            </div>
          )}
          {userTeams.length > 0 && (
            <div className="mt-1.5">
              <TeamChips teams={userTeams} dark={dark} max={6} />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`p-0.5 rounded shrink-0 ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Full status text (wraps; not truncated) */}
      <div className={`mt-3 rounded-md px-2 py-1.5 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50"}`}>
        {p.status?.trim() ? (
          <p className={`text-[12px] whitespace-pre-wrap break-words ${dark ? "text-slate-200" : "text-slate-700"}`}>
            {p.status}
          </p>
        ) : (
          <p className={`text-[12px] italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
            No status set
          </p>
        )}
        {p.status_updated_at && p.status?.trim() && (
          <p className={`text-[10px] mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Updated {relativeTime(p.status_updated_at)}
          </p>
        )}
      </div>

      {/* Self → edit my status */}
      {isSelf && typeof onEditMyStatus === "function" && (
        <button
          type="button"
          onClick={() => { onEditMyStatus(); onClose(); }}
          className={`mt-3 w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
            "bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
          }`}
        >
          <Pencil className="w-3 h-3" /> Edit my status
        </button>
      )}

      {/* Leader actions against others */}
      {viewerIsLeader && !isSelf && !isLeader && (
        <div className="mt-3 pt-3 border-t border-current/10">
          {confirming === "transfer" ? (
            <ConfirmRow
              dark={dark}
              prompt={`Transfer leadership to ${p.display_name || "this member"}?`}
              confirmLabel="Yes, transfer"
              confirmTone="primary"
              onConfirm={() => { onTransferLeader?.(p.user_id); onClose(); }}
              onCancel={() => setConfirming(null)}
            />
          ) : confirming === "kick" ? (
            <ConfirmRow
              dark={dark}
              prompt={`Remove ${p.display_name || "this member"} from the session?`}
              confirmLabel="Remove"
              confirmTone="danger"
              onConfirm={() => { onKickParticipant?.(p.user_id); onClose(); }}
              onCancel={() => setConfirming(null)}
            />
          ) : (
            <div className={allowMakeLeader ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-1 gap-1.5"}>
              {allowMakeLeader && (
                <button
                  type="button"
                  onClick={() => setConfirming("transfer")}
                  disabled={!onTransferLeader}
                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                    "bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
                  } disabled:opacity-40`}
                >
                  <ShieldCheck className="w-3 h-3" /> Make leader
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirming("kick")}
                disabled={!onKickParticipant}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                  dark ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "bg-red-50 text-red-600 hover:bg-red-100"
                } disabled:opacity-40`}
              >
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
