import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Target, History, Plus, MoreVertical, Archive, RotateCcw, Lock, Unlock, Trash2 } from "lucide-react";
import {
  listTeamRetros, formatRetroWeek,
  archiveRetro, unarchiveRetro, deleteRetro, setRetroLive,
} from "../lib/retro";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import NewRetroModal from "../components/NewRetroModal";
import RetroDeleteModal from "../components/RetroDeleteModal";

export default function RetrosListPage() {
  const { session } = useApp();
  const { activeTeam, activeTeamId, teamMembers, isAdmin, orgTeams, myOrgTeamIds, myOrgTeamLeadIds } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [retros, setRetros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [retroToDelete, setRetroToDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(null); // retro id mid-action

  // Filter tabs are URL-backed for deep-linking. Default "active" hides
  // archived; "archived" shows only archived; "all" shows everything.
  const statusFilter = searchParams.get("status") || "active";
  function setStatusFilter(v) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v && v !== "active") next.set("status", v);
      else next.delete("status");
      return next;
    }, { replace: true });
  }

  async function reloadRetros() {
    if (!activeTeamId) return;
    // Always fetch with includeArchived so we can compute tab counts
    // without a second round-trip.
    const { data } = await listTeamRetros(activeTeamId, { includeArchived: true });
    setRetros(data || []);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeTeamId) { setRetros([]); setLoading(false); return; }
      setLoading(true);
      const { data } = await listTeamRetros(activeTeamId, { includeArchived: true });
      if (cancelled) return;
      setRetros(data || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [activeTeamId]);

  // Teams the user can land a retro in: each org_team plus a synthetic
  // "Org-wide" bucket (id null) for the team-wide retro.
  const availableTeams = useMemo(() => {
    const base = [{ id: null, name: "Org-wide", color: activeTeam?.color || "#14b8a6" }];
    return base.concat((orgTeams || []).map((t) => ({ id: t.id, name: t.name, color: t.color })));
  }, [orgTeams, activeTeam?.color]);

  // Compute tab counts off the unfiltered set so the badges stay
  // honest regardless of which tab is selected.
  const counts = useMemo(() => {
    let active = 0, archived = 0;
    for (const r of retros) {
      if (r.archived_at) archived++;
      else active++;
    }
    return { active, archived, all: retros.length };
  }, [retros]);

  // Apply the active filter to the working set.
  const filteredRetros = useMemo(() => {
    if (statusFilter === "archived") return retros.filter((r) => r.archived_at);
    if (statusFilter === "all") return retros;
    return retros.filter((r) => !r.archived_at);
  }, [retros, statusFilter]);

  const currentWeekRetros = filteredRetros.filter((r) => r.is_current_week);
  const pastRetros = filteredRetros.filter((r) => !r.is_current_week);

  // Can the current user manage (archive / set live) this retro?
  // Admin always; lead of the retro's org_team also yes.
  function canManage(retro) {
    if (isAdmin) return true;
    if (retro.org_team_id && myOrgTeamLeadIds?.has(retro.org_team_id)) return true;
    return false;
  }

  async function handleToggleLive(retro) {
    setActionBusy(retro.id);
    const { error } = await setRetroLive(retro.id, !retro.is_live);
    setActionBusy(null);
    if (!error) reloadRetros();
  }

  async function handleArchive(retro) {
    setActionBusy(retro.id);
    const { error } = await archiveRetro(retro.id);
    setActionBusy(null);
    if (!error) reloadRetros();
  }

  async function handleUnarchive(retro) {
    setActionBusy(retro.id);
    const { error } = await unarchiveRetro(retro.id);
    setActionBusy(null);
    if (!error) reloadRetros();
  }

  async function handleDeleteConfirmed() {
    if (!retroToDelete) return;
    setDeleteBusy(true);
    const { error } = await deleteRetro(retroToDelete.id);
    setDeleteBusy(false);
    if (!error) {
      setRetroToDelete(null);
      reloadRetros();
    }
  }

  // Group past retros by week_start descending so each header is "Jun 1–7".
  const pastByWeek = useMemo(() => {
    const m = new Map();
    for (const r of pastRetros) {
      if (!m.has(r.week_start)) m.set(r.week_start, []);
      m.get(r.week_start).push(r);
    }
    return [...m.entries()];
  }, [pastRetros]);


  const cardCls = `rounded-2xl border p-4 ${
    dark ? "bg-slate-900/60 border-slate-700/50" : "bg-white border-slate-200 shadow-sm"
  }`;

  if (!activeTeam) {
    return (
      <main className="px-4 pt-6 pb-24 max-w-[920px] mx-auto">
        <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Join or create a team first to run a retro.
        </p>
      </main>
    );
  }

  return (
    <main className="px-4 pt-6 pb-24 max-w-[920px] mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {activeTeam.name}
          </p>
          <h1 className={`text-xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            Team Retros
          </h1>
          <p className={`text-xs mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
            Review the week and plan ahead. Create one when a team needs it.
          </p>
        </div>
        <Button onClick={() => setShowNewModal(true)} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" /> New retro
        </Button>
      </div>

      {/* Filter tabs — URL-backed so deep-links stay meaningful. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[
          { key: "active", label: "Active", count: counts.active },
          { key: "archived", label: "Archived", count: counts.archived },
          { key: "all", label: "All", count: counts.all },
        ].map((t) => {
          const active = statusFilter === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(t.key)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                active
                  ? dark ? "bg-cyan-500/15 border-cyan-500/50 text-cyan-200" : "bg-teal-50 border-teal-300 text-teal-700"
                  : dark
                    ? "bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-600"
                    : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {t.label}
              <span className={`px-1 rounded text-[10px] font-bold ${
                active
                  ? "bg-black/15"
                  : dark ? "bg-slate-700/50 text-slate-400" : "bg-slate-100 text-slate-500"
              }`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Current week — only retros that actually exist. No per-team
          stubs: not every team needs a retro (some teams are
          descriptive tags), so creation is an explicit step via the
          New retro button + modal. */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className={`text-sm font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}>
            This week
          </h2>
        </div>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <SkeletonCard key={i} className="h-32" />)}
          </div>
        ) : currentWeekRetros.length === 0 ? (
          <div className={`${cardCls} text-center border-dashed`}>
            <p className={`text-sm ${dark ? "text-slate-300" : "text-slate-700"}`}>
              No retros for this week yet.
            </p>
            <p className={`text-xs mt-1 mb-3 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Create one when a team needs to review the week and plan ahead.
            </p>
            <Button onClick={() => setShowNewModal(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" /> New retro
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {currentWeekRetros.map((existing) => {
              const teamColor = (orgTeams || []).find((t) => t.id === existing.org_team_id)?.color
                || activeTeam?.color
                || "#14b8a6";
              const teamName = existing.org_team_name || existing.department || "Org-wide";
              const mine = existing.org_team_id != null && myOrgTeamIds?.has(existing.org_team_id);
              return (
                <div key={existing.id} className="relative">
                  <Link
                    to={`/retros/${existing.id}`}
                    className={`${cardCls} block transition-colors ${
                      dark ? "hover:border-cyan-500/50" : "hover:border-teal-300"
                    } ${existing.archived_at ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2 pr-8">
                      <p className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"} flex items-center gap-1.5 min-w-0`}>
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: teamColor }}
                        />
                        <span className="truncate">{teamName}</span>
                        {mine && (
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dark ? "bg-amber-300" : "bg-amber-400"}`} title="You're on this team" />
                        )}
                      </p>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          existing.archived_at
                            ? dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700"
                            : existing.is_live
                              ? dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"
                              : dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {existing.archived_at ? "Archived" : existing.is_live ? "Live" : "Closed"}
                      </span>
                    </div>
                    {existing.goal && (
                      <p className={`mt-1.5 text-xs flex items-start gap-1.5 ${dark ? "text-slate-300" : "text-slate-600"}`}>
                        <Target className={`w-3 h-3 mt-0.5 shrink-0 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
                        <span className="line-clamp-2">
                          <span className={`text-[10px] uppercase tracking-wider font-bold mr-1 ${
                            dark ? "text-cyan-400" : "text-teal-600"
                          }`}>Next week:</span>
                          {existing.goal}
                        </span>
                      </p>
                    )}
                    <p className={`mt-2 text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                      {existing.card_count} {existing.card_count === 1 ? "card" : "cards"} · {formatRetroWeek(existing.week_start)}
                    </p>
                  </Link>
                  {canManage(existing) && (
                    <RetroKebab
                      dark={dark}
                      retro={existing}
                      isAdmin={isAdmin}
                      busy={actionBusy === existing.id}
                      onToggleLive={() => handleToggleLive(existing)}
                      onArchive={() => handleArchive(existing)}
                      onUnarchive={() => handleUnarchive(existing)}
                      onRequestDelete={() => setRetroToDelete(existing)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* History */}
      {pastByWeek.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <History className={`w-4 h-4 ${dark ? "text-slate-400" : "text-slate-500"}`} />
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}>
              History
            </h2>
          </div>
          <ul className="space-y-2">
            {pastByWeek.map(([weekStart, group]) => (
              <li key={weekStart} className={`${cardCls} p-3`}>
                <p className={`text-[11px] font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  {formatRetroWeek(weekStart)}
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {group.map((r) => (
                    <div key={r.id} className="relative">
                      <Link
                        to={`/retros/${r.id}`}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 pr-9 rounded-md text-sm ${
                          r.archived_at ? "opacity-60" : ""
                        } ${
                          dark ? "bg-slate-800/40 hover:bg-slate-800 text-slate-200" : "bg-slate-50 hover:bg-slate-100 text-slate-700"
                        }`}
                      >
                        <span className="truncate flex items-center gap-1.5">
                          {r.org_team_name || r.department || "Team"}
                          {r.archived_at && (
                            <Archive className={`w-3 h-3 ${dark ? "text-amber-400" : "text-amber-600"}`} />
                          )}
                        </span>
                        <span className={`text-[11px] shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                          {r.card_count} cards
                        </span>
                      </Link>
                      {canManage(r) && (
                        <RetroKebab
                          dark={dark}
                          retro={r}
                          isAdmin={isAdmin}
                          busy={actionBusy === r.id}
                          compact
                          onToggleLive={() => handleToggleLive(r)}
                          onArchive={() => handleArchive(r)}
                          onUnarchive={() => handleUnarchive(r)}
                          onRequestDelete={() => setRetroToDelete(r)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RetroDeleteModal
        open={!!retroToDelete}
        onClose={() => { if (!deleteBusy) setRetroToDelete(null); }}
        retro={retroToDelete}
        busy={deleteBusy}
        onConfirm={handleDeleteConfirmed}
      />

      <NewRetroModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        orgId={activeTeamId}
        availableTeams={availableTeams}
        existingTeamIds={
          new Set(currentWeekRetros.map((r) => r.org_team_id ?? null))
        }
        preselectedTeamId={
          (orgTeams || []).find((t) => myOrgTeamIds?.has(t.id))?.id ?? null
        }
        isAdmin={isAdmin}
        onCreated={(data) => {
          setRetros((prev) => [
            { ...data, is_current_week: true, is_live: true, card_count: 0 },
            ...prev.filter((r) => r.id !== data.id),
          ]);
          navigate(`/retros/${data.id}`);
        }}
      />
    </main>
  );
}

// Small overflow menu placed on a retro tile/row. Lives outside the
// Link so clicks don't navigate. Outside-click + Escape close it.
function RetroKebab({
  dark, retro, isAdmin, busy, compact,
  onToggleLive, onArchive, onUnarchive, onRequestDelete,
}) {
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

  const itemCls = `flex items-center gap-2 w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
    dark ? "text-slate-200 hover:bg-slate-700/60" : "text-slate-700 hover:bg-slate-100"
  }`;
  const destructiveCls = `flex items-center gap-2 w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
    dark ? "text-red-300 hover:bg-red-500/15" : "text-red-600 hover:bg-red-50"
  }`;

  const isArchived = !!retro.archived_at;

  return (
    <div
      ref={ref}
      className={`absolute ${compact ? "right-1.5 top-1/2 -translate-y-1/2" : "right-2 top-2"} z-10`}
      onClick={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Retro actions"
        disabled={busy}
        className={`h-6 w-6 rounded-md inline-flex items-center justify-center transition-colors ${
          dark
            ? "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60"
            : "bg-white/80 text-slate-600 hover:bg-slate-50 border border-slate-200"
        }`}
      >
        <MoreVertical className="w-3 h-3" />
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.preventDefault()}
          className={`absolute right-0 top-full mt-1 min-w-[160px] rounded-lg border shadow-lg overflow-hidden py-1 ${
            dark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"
          }`}
        >
          {!isArchived && (
            <button
              type="button"
              className={itemCls}
              onClick={(e) => { e.preventDefault(); setOpen(false); onToggleLive(); }}
            >
              {retro.is_live
                ? <><Lock className="w-3.5 h-3.5 opacity-70" /> Close</>
                : <><Unlock className="w-3.5 h-3.5 opacity-70" /> Reopen</>}
            </button>
          )}
          {!isArchived ? (
            <button
              type="button"
              className={itemCls}
              onClick={(e) => { e.preventDefault(); setOpen(false); onArchive(); }}
            >
              <Archive className="w-3.5 h-3.5 opacity-70" />
              Archive
            </button>
          ) : (
            <button
              type="button"
              className={itemCls}
              onClick={(e) => { e.preventDefault(); setOpen(false); onUnarchive(); }}
            >
              <RotateCcw className="w-3.5 h-3.5 opacity-70" />
              Unarchive
            </button>
          )}
          {isAdmin && (
            <>
              <div className={`my-1 h-px ${dark ? "bg-slate-700/60" : "bg-slate-200"}`} />
              <button
                type="button"
                className={destructiveCls}
                onClick={(e) => { e.preventDefault(); setOpen(false); onRequestDelete(); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
