import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Target, ArrowRight, History, Plus, Loader2 } from "lucide-react";
import {
  listTeamRetros, getOrCreateCurrentRetro, formatRetroWeek,
} from "../lib/retro";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import NewRetroModal from "../components/NewRetroModal";

export default function RetrosListPage() {
  const { session } = useApp();
  const { activeTeam, activeTeamId, teamMembers, isAdmin, orgTeams, myOrgTeamIds } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  const [retros, setRetros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingDept, setCreatingDept] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeTeamId) { setRetros([]); setLoading(false); return; }
      setLoading(true);
      const { data } = await listTeamRetros(activeTeamId);
      if (cancelled) return;
      setRetros(data);
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

  const currentWeekRetros = retros.filter((r) => r.is_current_week);
  const pastRetros = retros.filter((r) => !r.is_current_week);

  // Group past retros by week_start descending so each header is "Jun 1–7".
  const pastByWeek = useMemo(() => {
    const m = new Map();
    for (const r of pastRetros) {
      if (!m.has(r.week_start)) m.set(r.week_start, []);
      m.get(r.week_start).push(r);
    }
    return [...m.entries()];
  }, [pastRetros]);

  async function handleStartRetro(orgTeamId) {
    if (!activeTeamId) return;
    setCreatingDept(orgTeamId || "__org__");
    const { data, error } = await getOrCreateCurrentRetro(activeTeamId, orgTeamId);
    setCreatingDept(null);
    if (error) return;
    if (data) {
      setRetros((prev) => [
        { ...data, is_current_week: true, is_live: true, card_count: 0 },
        ...prev.filter((r) => r.id !== data.id),
      ]);
    }
  }

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
            Weekly reflection — one per department.
          </p>
        </div>
        <Button onClick={() => setShowNewModal(true)} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" /> New retro
        </Button>
      </div>

      {/* Current week */}
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
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availableTeams.map((team) => {
              // Match retros by org_team_id; team.id === null = org-wide retro.
              const existing = currentWeekRetros.find((r) =>
                team.id === null
                  ? (r.org_team_id == null)
                  : r.org_team_id === team.id,
              );
              const mine = team.id !== null && myOrgTeamIds?.has(team.id);
              const tileKey = team.id || "__org__";
              if (existing) {
                return (
                  <Link
                    key={tileKey}
                    to={`/retros/${existing.id}`}
                    className={`${cardCls} block transition-colors ${
                      dark ? "hover:border-cyan-500/50" : "hover:border-teal-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"} flex items-center gap-1.5 min-w-0`}>
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: team.color }}
                        />
                        <span className="truncate">{team.name}</span>
                        {mine && (
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dark ? "bg-amber-300" : "bg-amber-400"}`} title="You're on this team" />
                        )}
                      </p>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          existing.is_live
                            ? dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"
                            : dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {existing.is_live ? "Live" : "Closed"}
                      </span>
                    </div>
                    {existing.goal && (
                      <p className={`mt-1.5 text-xs flex items-start gap-1.5 ${dark ? "text-slate-300" : "text-slate-600"}`}>
                        <Target className={`w-3 h-3 mt-0.5 shrink-0 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
                        <span className="line-clamp-2">{existing.goal}</span>
                      </p>
                    )}
                    <p className={`mt-2 text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                      {existing.card_count} {existing.card_count === 1 ? "card" : "cards"} · {formatRetroWeek(existing.week_start)}
                    </p>
                  </Link>
                );
              }
              const busyKey = team.id || "__org__";
              return (
                <button
                  key={tileKey}
                  type="button"
                  onClick={() => handleStartRetro(team.id)}
                  disabled={creatingDept === busyKey}
                  className={`${cardCls} text-left transition-colors flex flex-col items-start gap-2 border-dashed ${
                    dark
                      ? "hover:border-cyan-500/50 hover:bg-slate-900"
                      : "hover:border-teal-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <p className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"} flex items-center gap-1.5 min-w-0`}>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: team.color }}
                      />
                      <span className="truncate">{team.name}</span>
                      {mine && (
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dark ? "bg-amber-300" : "bg-amber-400"}`} title="You're on this team" />
                      )}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md ${
                      dark
                        ? "bg-cyan-500/15 text-cyan-300"
                        : "bg-teal-50 text-teal-700"
                    }`}
                  >
                    {creatingDept === busyKey
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Plus className="w-3.5 h-3.5" />}
                    {creatingDept === busyKey ? "Creating…" : "Start retro"}
                  </span>
                  <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    Opens a fresh board for this week.
                  </p>
                </button>
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
                    <Link
                      key={r.id}
                      to={`/retros/${r.id}`}
                      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-sm ${
                        dark ? "bg-slate-800/40 hover:bg-slate-800 text-slate-200" : "bg-slate-50 hover:bg-slate-100 text-slate-700"
                      }`}
                    >
                      <span className="truncate">{r.department || "Team"}</span>
                      <span className={`text-[11px] shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                        {r.card_count} cards
                      </span>
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && retros.length === 0 && (
        <div className={`text-center py-8 rounded-2xl border border-dashed ${
          dark ? "border-slate-700/60 text-slate-400" : "border-slate-300 text-slate-500"
        }`}>
          <p className="text-sm">No retros yet for this team.</p>
          <Button onClick={() => setShowNewModal(true)} className="mt-3">
            <Plus className="w-4 h-4 mr-1" /> Start your first retro
          </Button>
        </div>
      )}

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
