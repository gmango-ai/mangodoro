import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useTeam } from "../context/TeamContext";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import FileDropZone from "../components/FileDropZone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users, Plus, LogIn, Copy, RefreshCw, Trash2, Crown, UserMinus,
  ChevronDown, FileSpreadsheet, ArrowRight, Timer, Palette, Check, Target, Briefcase, Users2, Building2, ShieldAlert,
} from "lucide-react";
import UserAvatar from "../components/UserAvatar";
import { Skeleton, SkeletonCard, SkeletonCircle } from "../components/Skeleton";
import OrgTeamsCard from "../components/OrgTeamsCard";
import OrgTeamMembersModal from "../components/OrgTeamMembersModal";
import MemberHRModal from "../components/MemberHRModal";
import MemberTeamsModal from "../components/MemberTeamsModal";
import { joinSyncSession } from "../lib/syncSession";
import { notifySessionJoined } from "../sync/joinSession";
import { uploadTeamIcon, deleteTeamIcon } from "../lib/teamIcon";
import { listOrgTeamMembers } from "../lib/orgTeam";
import { supabase } from "../supabase";

const TEAM_COLORS = [
  "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899",
  "#f43f5e", "#f59e0b", "#84cc16", "#10b981", "#64748b",
];

export default function TeamPage() {
  const {
    teams, activeTeam, activeTeamId, teamMembers, teamLoading, isAdmin, orgTeams, loadOrgTeamsForActive,
    switchTeam, createTeam, joinTeam, leaveTeam, deleteTeam, updateTeam,
    removeMember, changeMemberRole, regenerateInviteCode, updateMemberHR,
    activeTeamSessions, loadActiveTeamSessions,
  } = useTeam();
  const { settings, session } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState("manage"); // "manage" | "create" | "join"
  const [newTeamName, setNewTeamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);
  // Which org_team's member-management modal is open. Null = none.
  const [managingTeam, setManagingTeam] = useState(null);
  const [hrMember, setHrMember] = useState(null);
  // Map of org_team_id -> member count. Loaded lazily for the cards.
  const [orgTeamMemberCounts, setOrgTeamMemberCounts] = useState(new Map());
  // Map of user_id → array of org_team rows the user belongs to. Drives
  // the team chips on each member row and the MemberTeamsModal.
  const [teamsByUserId, setTeamsByUserId] = useState(new Map());

  // Refetch all team memberships whenever the org_teams list changes.
  useEffect(() => {
    if (!orgTeams || orgTeams.length === 0) {
      setOrgTeamMemberCounts(new Map());
      setTeamsByUserId(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(orgTeams.map((t) => listOrgTeamMembers(t.id))).then((results) => {
      if (cancelled) return;
      const counts = new Map();
      const byUser = new Map();
      orgTeams.forEach((t, i) => {
        const rows = results[i]?.data || [];
        counts.set(t.id, rows.length);
        for (const r of rows) {
          const list = byUser.get(r.user_id) || [];
          list.push(t);
          byUser.set(r.user_id, list);
        }
      });
      setOrgTeamMemberCounts(counts);
      setTeamsByUserId(byUser);
    });
    return () => { cancelled = true; };
  }, [orgTeams]);

  // Per-member team-management modal (member-centric, distinct from the
  // team-centric OrgTeamMembersModal opened from the Teams card).
  const [memberTeamsModalFor, setMemberTeamsModalFor] = useState(null);

  // Auto-join from URL. Used to just pre-fill the field; now actually
  // performs the join so a one-click invite link works without the user
  // having to find the Join tab and press the button.
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const code = searchParams.get("join");
    if (!code || teamLoading) return;
    const codeNormalized = code.trim().toLowerCase();
    // Already a member? Just switch to that team and clear the URL.
    const existing = teams.find((t) => (t.invite_code || "").toLowerCase() === codeNormalized);
    if (existing) {
      autoJoinedRef.current = true;
      switchTeam(existing.id);
      navigate("/team", { replace: true });
      return;
    }
    autoJoinedRef.current = true;
    setJoinCode(code);
    setLoading(true);
    joinTeam(code).then(({ error: err }) => {
      setLoading(false);
      if (err) {
        setError(err.message || "Invalid invite code");
        autoJoinedRef.current = false; // allow retry via the form
        return;
      }
      setSuccess("Joined team!");
      setTab("manage");
      navigate("/team", { replace: true });
      setTimeout(() => setSuccess(""), 3000);
    });
  }, [searchParams, teamLoading, teams, joinTeam, switchTeam, navigate]);

  // If the user lands on /team and we genuinely have no teams, default
  // them onto the Create form. But track that WE auto-switched — if teams
  // later populate (e.g. the initial loadTeams hit an auth race and a
  // follow-up fetch succeeds), flip back to "manage" so the user actually
  // sees their teams instead of staying stuck on the Create form.
  const autoSwitchedToCreateRef = useRef(false);
  useEffect(() => {
    if (teamLoading) return;
    if (teams.length === 0 && tab === "manage" && !autoSwitchedToCreateRef.current) {
      autoSwitchedToCreateRef.current = true;
      setTab("create");
    } else if (teams.length > 0 && autoSwitchedToCreateRef.current) {
      autoSwitchedToCreateRef.current = false;
      setTab("manage");
    }
  }, [teamLoading, teams.length, tab]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    setLoading(true); setError("");
    const { error: err } = await createTeam(newTeamName.trim());
    setLoading(false);
    if (err) { setError(err.message); return; }
    setNewTeamName("");
    setSuccess("Team created!");
    setTab("manage");
    setTimeout(() => setSuccess(""), 3000);
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setLoading(true); setError("");
    const { error: err } = await joinTeam(joinCode.trim());
    setLoading(false);
    if (err) { setError(err.message || "Invalid invite code"); return; }
    setJoinCode("");
    setSuccess("Joined team!");
    setTab("manage");
    setTimeout(() => setSuccess(""), 3000);
  }

  async function handleCopyCode() {
    if (!activeTeam?.invite_code) return;
    await navigator.clipboard.writeText(activeTeam.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyLink() {
    if (!activeTeam?.invite_code) return;
    const link = `${window.location.origin}/team/join/${activeTeam.invite_code}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRegenerateCode() {
    if (!activeTeamId) return;
    setLoading(true);
    await regenerateInviteCode(activeTeamId);
    setLoading(false);
    setSuccess("Invite code regenerated");
    setTimeout(() => setSuccess(""), 3000);
  }

  async function handleRemoveMember(memberId) {
    if (!activeTeamId) return;
    await removeMember(activeTeamId, memberId);
  }

  async function handleToggleRole(memberId, currentRole) {
    if (!activeTeamId) return;
    await changeMemberRole(activeTeamId, memberId, currentRole === "admin" ? "member" : "admin");
  }

  async function handleLeave() {
    if (!activeTeamId) return;
    await leaveTeam(activeTeamId);
    setConfirmLeave(false);
    setSuccess("Left team");
    setTimeout(() => setSuccess(""), 3000);
  }

  async function handleDelete() {
    if (!activeTeamId) return;
    await deleteTeam(activeTeamId);
    setConfirmDelete(false);
    setSuccess("Team deleted");
    setTimeout(() => setSuccess(""), 3000);
  }

  async function handleJoinTeamSession(s) {
    const name = (settings?.name || "").trim();
    if (!name) {
      setError("Set a display name in Settings before joining a sync session.");
      return;
    }
    setLoading(true); setError("");
    const { data, error: err } = await joinSyncSession(s.join_code, name);
    setLoading(false);
    if (err) {
      const msg = err.message?.includes("display_name_required")
        ? "A display name is required."
        : err.message || "Could not join session.";
      setError(msg);
      return;
    }
    if (data?.session) {
      notifySessionJoined(data.session);
      navigate("/pomodoro");
    }
  }

  function fmtTimeLeft(s) {
    if (!s) return "";
    if (!s.is_running || !s.ends_at) return `${Math.ceil((s.remaining_seconds || 0) / 60)}m left`;
    const ms = new Date(s.ends_at).getTime() - Date.now();
    const minsLeft = Math.max(0, Math.ceil(ms / 60000));
    return `${minsLeft}m left`;
  }
  const modeLabel = (m) => m === "shortBreak" ? "Short break" : m === "longBreak" ? "Long break" : "Focus";

  const cardCls = `rounded-xl border p-5 ${
    dark
      ? "bg-slate-900/60 border-slate-700/50 shadow-lg shadow-black/20"
      : "bg-white border-slate-200 shadow-sm"
  }`;
  const labelCls = `text-xs font-medium uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`;
  const headingCls = `text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`;
  const subCls = `text-sm ${dark ? "text-slate-400" : "text-slate-500"}`;
  const inputCls = dark
    ? "bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500"
    : "";

  // Show the skeleton until TeamContext has at least tried to load teams
  // once. Without this gate the initial render shows "No teams yet" /
  // auto-switches to the Create tab during the brief loading window.
  if (teamLoading && teams.length === 0) {
    return (
      <main
        className="px-4 pt-6 pb-24 max-w-[720px] mx-auto space-y-6"
        aria-busy="true"
        aria-label="Loading teams"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-lg" />
            <Skeleton className="h-6 w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
        <SkeletonCard className="p-5 space-y-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </SkeletonCard>
        <SkeletonCard className="p-5 space-y-3">
          <Skeleton className="h-3 w-28" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <SkeletonCircle size={32} />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-5 w-14 rounded-md" />
            </div>
          ))}
        </SkeletonCard>
      </main>
    );
  }

  return (
    <main className="px-4 pt-6 pb-24 max-w-[720px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${dark ? "bg-cyan-500/10" : "bg-teal-50"}`}>
            <Users className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
          </div>
          <h1 className={`text-xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Orgs</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant={tab === "create" ? "default" : "outline"}
            size="sm"
            onClick={() => { setTab("create"); setError(""); }}
          >
            <Plus className="w-4 h-4 mr-1" /> Create
          </Button>
          <Button
            variant={tab === "join" ? "default" : "outline"}
            size="sm"
            onClick={() => { setTab("join"); setError(""); }}
          >
            <LogIn className="w-4 h-4 mr-1" /> Join
          </Button>
        </div>
      </div>

      {/* Success/Error */}
      {success && (
        <div className={`text-sm font-medium px-4 py-2 rounded-lg ${dark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"}`}>
          {success}
        </div>
      )}
      {error && (
        <div className={`text-sm font-medium px-4 py-2 rounded-lg ${dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"}`}>
          {error}
        </div>
      )}

      {/* Create Team */}
      {tab === "create" && (
        <div className={cardCls}>
          <h2 className={headingCls}>Create a Team</h2>
          <p className={`${subCls} mt-1 mb-4`}>Start a team and invite your coworkers to join.</p>
          <form onSubmit={handleCreate} className="flex gap-2">
            <Input
              placeholder="Team name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              className={`flex-1 ${inputCls}`}
            />
            <Button type="submit" disabled={loading || !newTeamName.trim()}>
              {loading ? "Creating…" : "Create"}
            </Button>
          </form>
        </div>
      )}

      {/* Join Team */}
      {tab === "join" && (
        <div className={cardCls}>
          <h2 className={headingCls}>Join a Team</h2>
          <p className={`${subCls} mt-1 mb-4`}>Enter the invite code shared by your team admin.</p>
          <form onSubmit={handleJoin} className="flex gap-2">
            <Input
              placeholder="Invite code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              className={`flex-1 font-mono ${inputCls}`}
            />
            <Button type="submit" disabled={loading || !joinCode.trim()}>
              {loading ? "Joining…" : "Join"}
            </Button>
          </form>
        </div>
      )}

      {/* Team Selector (if multiple) */}
      {teams.length > 1 && tab === "manage" && (
        <div className={cardCls}>
          <p className={labelCls}>Your Teams</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {teams.map((t) => (
              <Button
                key={t.id}
                variant={t.id === activeTeamId ? "default" : "outline"}
                size="sm"
                onClick={() => switchTeam(t.id)}
                className="flex items-center gap-1.5"
              >
                <TeamIcon team={t} size={18} />
                {t.name}
                {t.role === "admin" && <Crown className="w-3 h-3 ml-1 opacity-60" />}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Active Team Details */}
      {activeTeam && tab === "manage" && (
        <>
          {/* Active pomodoro sessions */}
          {activeTeamSessions.length > 0 && (
            <div className={cardCls}>
              <div className="flex items-center justify-between mb-3">
                <p className={labelCls}>Active pomodoros</p>
                <Timer className={`w-4 h-4 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
              </div>
              <div className="space-y-2">
                {activeTeamSessions.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                      dark ? "bg-slate-800/40" : "bg-slate-50"
                    }`}
                  >
                    <UserAvatar url={s.leader_avatar} name={s.leader_name} size={32} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${dark ? "text-slate-200" : "text-slate-700"}`}>
                        {s.leader_name}
                      </p>
                      <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                        {modeLabel(s.mode)} · {s.participant_count}/{s.max_participants} · {fmtTimeLeft(s)}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => handleJoinTeamSession(s)} disabled={loading}>
                      Join
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── ORG ─────────────────────────────────────────────── */}
          {isAdmin && (
            <SectionHeader
              icon={Building2}
              title="Org"
              subtitle="Profile and how others join"
              dark={dark}
            />
          )}

          {/* Team Settings (admin only) — name, icon, accent color */}
          {isAdmin && (
            <TeamSettingsCard
              key={activeTeam.id}
              team={activeTeam}
              dark={dark}
              cardCls={cardCls}
              labelCls={labelCls}
              inputCls={inputCls}
              onSave={(patch) => updateTeam(activeTeam.id, patch)}
              onUploadIcon={async (file) => uploadTeamIcon(file, activeTeam.id)}
              onDeleteIcon={async (url) => deleteTeamIcon(url)}
              onSuccess={(msg) => { setSuccess(msg); setTimeout(() => setSuccess(""), 3000); }}
              onError={(msg) => setError(msg)}
            />
          )}

          {/* ─── TEAMS ───────────────────────────────────────────── */}
          {isAdmin && (
            <SectionHeader
              icon={Users2}
              title="Teams"
              subtitle="SWE, PM, HR — gate rooms, retros, and goals"
              dark={dark}
            />
          )}

          {/* OrgTeamsCard — only org admins */}
          {isAdmin && (
            <OrgTeamsCard
              dark={dark}
              cardCls={cardCls}
              labelCls={labelCls}
              inputCls={inputCls}
              teams={orgTeams || []}
              memberCountByTeamId={orgTeamMemberCounts}
              orgId={activeTeam.id}
              userId={session?.user?.id || activeTeam.created_by}
              onError={(msg) => setError(msg)}
              onSuccess={(msg) => { setSuccess(msg); setTimeout(() => setSuccess(""), 3000); }}
              onManageMembers={(t) => setManagingTeam(t)}
            />
          )}

          {/* Invite Code Card (admin only) */}
          {isAdmin && (
            <div className={cardCls}>
              <div className="flex items-center justify-between mb-3">
                <p className={labelCls}>Invite Code</p>
                <Button variant="ghost" size="sm" onClick={handleRegenerateCode} disabled={loading}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Regenerate
                </Button>
              </div>
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg font-mono text-lg tracking-widest ${
                dark ? "bg-slate-800/80 text-cyan-400" : "bg-slate-50 text-teal-600"
              }`}>
                <span className="flex-1">{activeTeam.invite_code}</span>
                <Button variant="ghost" size="sm" onClick={handleCopyCode}>
                  <Copy className="w-4 h-4" /> {copied ? "Copied!" : "Code"}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCopyLink}>
                  <Copy className="w-4 h-4" /> Link
                </Button>
              </div>
            </div>
          )}

          {/* ─── MEMBERS ─────────────────────────────────────────── */}
          <SectionHeader
            icon={Users}
            title="Members"
            subtitle={`${teamMembers.length} ${teamMembers.length === 1 ? "person" : "people"} in ${activeTeam.name}`}
            dark={dark}
          />
          <div className={cardCls}>
            <div className="space-y-2">
              {teamMembers.map((m) => (
                <MemberCard
                  key={m.user_id}
                  member={m}
                  dark={dark}
                  isAdmin={isAdmin}
                  isOwner={m.user_id === activeTeam.created_by}
                  teamsForUser={teamsByUserId.get(m.user_id) || []}
                  onEditHR={() => setHrMember(m)}
                  onEditTeams={() => setMemberTeamsModalFor(m)}
                  onToggleRole={() => handleToggleRole(m.user_id, m.role)}
                  onRemove={() => handleRemoveMember(m.user_id)}
                />
              ))}
            </div>
          </div>

          {/* ─── QUICK LINKS ─────────────────────────────────────── */}
          <SectionHeader
            icon={ArrowRight}
            title="Quick links"
            subtitle="Jump to retros, timesheets, and live sessions"
            dark={dark}
          />
          <button
            onClick={() => navigate("/retros")}
            className={`w-full ${cardCls} flex items-center justify-between hover:border-teal-500/50 transition-colors cursor-pointer`}
          >
            <div className="flex items-center gap-3">
              <Target className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
              <div className="text-left">
                <p className={headingCls}>Team Retro</p>
                <p className={subCls}>Celebrate, reflect, and set this week's goal</p>
              </div>
            </div>
            <ArrowRight className={`w-5 h-5 ${dark ? "text-slate-500" : "text-slate-400"}`} />
          </button>
          {isAdmin && (
            <button
              onClick={() => navigate("/team/timesheets")}
              className={`w-full ${cardCls} flex items-center justify-between hover:border-teal-500/50 transition-colors cursor-pointer`}
            >
              <div className="flex items-center gap-3">
                <FileSpreadsheet className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
                <div className="text-left">
                  <p className={headingCls}>Team Timesheets</p>
                  <p className={subCls}>View and export member timesheets</p>
                </div>
              </div>
              <ArrowRight className={`w-5 h-5 ${dark ? "text-slate-500" : "text-slate-400"}`} />
            </button>
          )}

          {/* ─── DANGER ──────────────────────────────────────────── */}
          <SectionHeader
            icon={ShieldAlert}
            title="Danger zone"
            subtitle="Leave or delete this org — both are permanent"
            dark={dark}
            danger
          />
          <div className={`${cardCls} border-red-500/20`}>
            <div className="flex gap-2 mt-3">
              {!confirmLeave ? (
                <Button variant="outline" size="sm" onClick={() => setConfirmLeave(true)}>
                  Leave Team
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${dark ? "text-slate-300" : "text-slate-600"}`}>Sure?</span>
                  <Button variant="destructive" size="sm" onClick={handleLeave}>Yes, Leave</Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmLeave(false)}>Cancel</Button>
                </div>
              )}
              {isAdmin && (
                !confirmDelete ? (
                  <Button variant="outline" size="sm" className="text-red-500 border-red-500/30" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Team
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${dark ? "text-slate-300" : "text-slate-600"}`}>Delete "{activeTeam.name}"?</span>
                    <Button variant="destructive" size="sm" onClick={handleDelete}>Yes, Delete</Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  </div>
                )
              )}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!teamLoading && teams.length === 0 && tab === "manage" && (
        <div className={`${cardCls} text-center py-12`}>
          <Users className={`w-12 h-12 mx-auto mb-3 ${dark ? "text-slate-600" : "text-slate-300"}`} />
          <p className={headingCls}>No teams yet</p>
          <p className={`${subCls} mt-1`}>Create a team or join one with an invite code.</p>
        </div>
      )}

      <OrgTeamMembersModal
        open={!!managingTeam}
        onClose={() => setManagingTeam(null)}
        orgTeam={managingTeam}
        orgMembers={teamMembers}
        onChange={() => {
          // Refresh team-list + member-count side state.
          loadOrgTeamsForActive?.();
          if (managingTeam?.id) {
            listOrgTeamMembers(managingTeam.id).then(({ data }) => {
              setOrgTeamMemberCounts((prev) => {
                const next = new Map(prev);
                next.set(managingTeam.id, (data || []).length);
                return next;
              });
            });
          }
        }}
      />

      <MemberHRModal
        open={!!hrMember}
        onClose={() => setHrMember(null)}
        member={hrMember}
        onSave={async (patch) => {
          if (!hrMember || !activeTeamId) return { error: { message: "No member selected" } };
          return await updateMemberHR(activeTeamId, hrMember.user_id, patch);
        }}
      />

      <MemberTeamsModal
        open={!!memberTeamsModalFor}
        onClose={() => setMemberTeamsModalFor(null)}
        member={memberTeamsModalFor}
        orgTeams={orgTeams || []}
        currentTeamIds={
          memberTeamsModalFor
            ? (teamsByUserId.get(memberTeamsModalFor.user_id) || []).map((t) => t.id)
            : []
        }
        onChange={() => {
          // Realtime usually catches this via the org_team_members
          // subscription in TeamContext, but kick a manual refresh too
          // so the chip strip on the row updates the same tick.
          loadOrgTeamsForActive?.();
        }}
      />
    </main>
  );
}

// Small section header. Used to group the page (Org → Teams →
// Members → Quick links → Danger) so admins don't see one tall stack
// of cards with no semantic structure.
function SectionHeader({ icon: Icon, title, subtitle, dark, danger = false }) {
  return (
    <div className="flex items-start gap-2.5 px-1 pt-3">
      <div
        className={`p-1.5 rounded-lg shrink-0 ${
          danger
            ? dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"
            : dark ? "bg-cyan-500/10 text-cyan-400" : "bg-teal-50 text-teal-600"
        }`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <h2 className={`text-sm font-bold uppercase tracking-wider ${
          danger
            ? dark ? "text-red-300" : "text-red-600"
            : dark ? "text-slate-100" : "text-slate-800"
        }`}>
          {title}
        </h2>
        {subtitle && (
          <p className={`text-[11px] mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// Per-member card. Two-row layout: identity + role/classification
// tagline on top, team chips + admin actions on the bottom. Reads as
// "who they are, what they are, what they're on, what I can do."
function MemberCard({
  member: m, dark, isAdmin, isOwner,
  teamsForUser, onEditHR, onEditTeams, onToggleRole, onRemove,
}) {
  const presenceRing = (() => {
    switch (m.presence_state) {
      case "in_meeting": return "ring-rose-500";
      case "heads_down": return "ring-violet-500";
      case "away":       return "ring-amber-500";
      default:           return "ring-emerald-500";
    }
  })();
  const presenceLabel = (() => {
    switch (m.presence_state) {
      case "in_meeting": return "In meeting";
      case "heads_down": return "Heads-down";
      case "away":       return "Away";
      case "available":  return "Available";
      default:           return "Active";
    }
  })();
  const joinedDate = new Date(m.joined_at).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  const taglineParts = [];
  if (m.role === "admin") taglineParts.push(isOwner ? "Owner" : "Admin");
  else taglineParts.push("Member");
  if (m.classification === "salary") taglineParts.push("Salary");
  else if (m.classification === "hourly") {
    taglineParts.push(`Hourly${m.hourly_rate ? ` · $${Number(m.hourly_rate).toFixed(0)}/hr` : ""}`);
  }

  return (
    <div className={`rounded-xl px-3 py-3 ${dark ? "bg-slate-800/40" : "bg-slate-50"}`}>
      {/* Row 1: identity + actions */}
      <div className="flex items-start gap-3">
        {/* Avatar + presence ring + admin crown overlay */}
        <div className={`relative shrink-0 rounded-full ring-2 ring-offset-2 ${presenceRing} ${
          dark ? "ring-offset-slate-800/40" : "ring-offset-slate-50"
        }`}>
          <UserAvatar url={m.avatar_url} name={m.name} size={40} />
          {m.role === "admin" && (
            <span
              className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow ${
                dark ? "bg-amber-400 text-slate-900" : "bg-amber-400 text-white"
              }`}
              title={isOwner ? "Owner" : "Admin"}
            >
              <Crown className="w-3 h-3" fill="currentColor" />
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {m.name}
          </p>
          <p className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {presenceLabel}
            {m.status ? ` · ${m.status}` : ""}
            {" · "}Joined {joinedDate}
          </p>
          <p className={`text-[11px] mt-0.5 truncate ${dark ? "text-slate-300" : "text-slate-600"}`}>
            {taglineParts.join(" · ")}
          </p>
        </div>

        {/* Admin actions — compact icon row aligned top-right */}
        {isAdmin && (
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onEditHR}
              title="Edit HR fields"
            >
              <Briefcase className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onEditTeams}
              title="Manage team memberships"
            >
              <Users2 className="w-3.5 h-3.5" />
            </Button>
            {!isOwner && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onToggleRole}
                  title={m.role === "admin" ? "Demote to member" : "Promote to admin"}
                >
                  <Crown className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                  onClick={onRemove}
                  title="Remove from org"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Row 2: team chips */}
      {(teamsForUser.length > 0 || isAdmin) && (
        <div className={`mt-3 pt-2.5 border-t ${dark ? "border-slate-700/40" : "border-slate-200/70"} flex flex-wrap items-center gap-1.5`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            Teams
          </span>
          {teamsForUser.length === 0 && (
            <span className={`text-[11px] italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
              No teams yet
            </span>
          )}
          {teamsForUser.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: `${t.color}22`,
                color: dark ? "#fff" : t.color,
                border: `1px solid ${t.color}55`,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
              {t.name}
            </span>
          ))}
          {isAdmin && (
            <button
              type="button"
              onClick={onEditTeams}
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border border-dashed transition-colors ${
                dark
                  ? "border-slate-600 text-slate-400 hover:border-cyan-500/60 hover:text-cyan-300"
                  : "border-slate-300 text-slate-500 hover:border-teal-400 hover:text-teal-600"
              }`}
            >
              + Manage
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TeamIcon({ team, size = 32 }) {
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

function TeamSettingsCard({ team, dark, cardCls, labelCls, inputCls, onSave, onUploadIcon, onDeleteIcon, onSuccess, onError }) {
  const [nameDraft, setNameDraft] = useState(team.name || "");
  const [colorDraft, setColorDraft] = useState(team.color || "#14b8a6");
  const [iconUrl, setIconUrl] = useState(team.icon_url || "");
  const [vibeDraft, setVibeDraft] = useState(team.office_vibe || "quiet");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-sync drafts when switching teams.
  useEffect(() => {
    setNameDraft(team.name || "");
    setColorDraft(team.color || "#14b8a6");
    setIconUrl(team.icon_url || "");
    setVibeDraft(team.office_vibe || "quiet");
  }, [team.id]);

  async function processFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      if (iconUrl) await onDeleteIcon?.(iconUrl);
      const { data, error } = await onUploadIcon(file);
      if (error) { onError?.(error.message || "Upload failed"); return; }
      setIconUrl(data.url);
    } catch (err) {
      onError?.(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const dirty =
    nameDraft.trim() !== (team.name || "").trim()
    || colorDraft !== (team.color || "#14b8a6")
    || iconUrl !== (team.icon_url || "")
    || vibeDraft !== (team.office_vibe || "quiet");

  async function handleRemoveIcon() {
    if (iconUrl) await onDeleteIcon?.(iconUrl);
    setIconUrl("");
  }

  async function handleSave() {
    const cleanName = nameDraft.trim();
    if (!cleanName) { onError?.("Team name can't be empty."); return; }
    setBusy(true);
    const { error } = await onSave({
      name: cleanName,
      color: colorDraft,
      icon_url: iconUrl || null,
      office_vibe: vibeDraft,
    });
    setBusy(false);
    if (error) { onError?.(error.message || "Could not save team settings."); return; }
    onSuccess?.("Team settings saved");
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-3">
        <p className={labelCls}>Team Settings</p>
        <Palette className={`w-4 h-4 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
      </div>

      <div className="space-y-4">
        <FileDropZone
          accept={{ "image/*": [] }}
          maxSize={2 * 1024 * 1024}
          uploading={uploading}
          buttonLabel={iconUrl ? "Replace icon" : "Upload icon"}
          hint="Click or drop an image · max 2 MB"
          onFile={processFile}
          onReject={(msg) => onError?.(msg)}
          actions={iconUrl ? (
            <button
              type="button"
              onClick={handleRemoveIcon}
              className={`text-[11px] font-medium px-2 py-1 rounded ${
                dark ? "text-slate-500 hover:text-red-300" : "text-slate-500 hover:text-red-500"
              }`}
            >
              Remove
            </button>
          ) : null}
        >
          <TeamIcon team={{ name: nameDraft || team.name, color: colorDraft, icon_url: iconUrl }} size={56} />
        </FileDropZone>

        {/* Name editor */}
        <div>
          <p className={labelCls}>Name</p>
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value.slice(0, 60))}
            placeholder="Team name"
            maxLength={60}
            className={`${inputCls} mt-1 max-w-sm`}
          />
        </div>

        {/* Color picker */}
        <div>
          <p className={labelCls}>Accent color</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColorDraft(c)}
                title={c}
                aria-label={`Use color ${c}`}
                className="w-7 h-7 rounded-md transition-transform hover:scale-110 shrink-0 flex items-center justify-center"
                style={{
                  background: c,
                  outline: colorDraft.toLowerCase() === c.toLowerCase()
                    ? `2px solid ${dark ? "#fff" : "#0f172a"}`
                    : "2px solid transparent",
                  outlineOffset: "1px",
                }}
              >
                {colorDraft.toLowerCase() === c.toLowerCase() && (
                  <Check className="w-3.5 h-3.5 text-white drop-shadow" />
                )}
              </button>
            ))}
            {/* Hex input for free-form color */}
            <label className={`inline-flex items-center gap-1.5 text-xs font-medium ${dark ? "text-slate-400" : "text-slate-500"}`}>
              <input
                type="color"
                value={colorDraft}
                onChange={(e) => setColorDraft(e.target.value)}
                className="w-7 h-7 rounded-md cursor-pointer p-0 border-none bg-transparent"
                aria-label="Custom color"
              />
              Custom
            </label>
          </div>
        </div>

        {/* Office vibe — controls the pomodoro rooms grid animation */}
        <div>
          <p className={labelCls}>Office vibe</p>
          <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"} mt-0.5 mb-2`}>
            How active the rooms grid feels when a session is running.
          </p>
          <div className={`inline-flex rounded-lg p-0.5 ${dark ? "bg-slate-800/60" : "bg-slate-100"}`}>
            {[
              ["quiet", "Quiet"],
              ["active", "Active"],
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setVibeDraft(v)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  vibeDraft === v
                    ? dark ? "bg-slate-700 text-white" : "bg-white text-slate-800 shadow-sm"
                    : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={!dirty || busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
