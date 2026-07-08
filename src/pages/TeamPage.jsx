import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { useTeam } from "../context/TeamContext";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import FileDropZone from "../components/FileDropZone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Users, Plus, LogIn, Copy, RefreshCw, Trash2, Crown, UserMinus,
  ChevronDown, FileSpreadsheet, ArrowRight, Timer, Palette, Check, Target, Users2, Building2, ShieldAlert, DollarSign,
  MoreVertical, Search, X, Star, Briefcase, Pencil, Archive, Volume2,
  ArrowRightLeft, GitBranch, Settings as SettingsIcon,
} from "lucide-react";
import UserAvatar from "../components/UserAvatar";
import MemberIdentity from "../components/MemberIdentity";
import TeamGoals from "../components/team/TeamGoals";
import OrgProjects from "../components/team/OrgProjects";
import OrgChart from "../components/team/OrgChart";
import { Skeleton, SkeletonCard, SkeletonCircle } from "../components/Skeleton";
import OrgTeamsCard from "../components/OrgTeamsCard";
import OfficeLayoutEditor from "../components/OfficeLayoutEditor";
import CreateRoomModal from "../components/CreateRoomModal";
import MemberHRModal from "../components/MemberHRModal";
import MemberTeamsModal from "../components/MemberTeamsModal";
import MemberManagerModal from "../components/MemberManagerModal";
import { setMemberManager } from "../lib/hr";
import InviteCard from "../components/InviteCard";
import RemoveMemberModal from "../components/RemoveMemberModal";
import { archiveRoomV2 } from "../lib/rooms";
import RoomSettingsModal from "../components/RoomSettingsModal";
import OrgDevicesPanel from "../components/OrgDevicesPanel";
import { joinSyncSession } from "../lib/syncSession";
import { getShareableBaseUrl } from "../lib/platform";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { notifySessionJoined } from "../sync/joinSession";
import { uploadTeamIcon, deleteTeamIcon } from "../lib/teamIcon";
import { compressImage } from "../lib/imageCompress";
import { supabase } from "../supabase";

const TEAM_COLORS = [
  "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899",
  "#f43f5e", "#f59e0b", "#84cc16", "#10b981", "#64748b",
];

export default function TeamPage() {
  const {
    teams, activeTeam, activeTeamId, teamMembers, teamLoading, isAdmin, isOwner, orgTeams, loadOrgTeamsForActive, loadMembers,
    teamsByUserId, orgTeamMemberCounts, myOrgTeamLeadIds,
    rooms, loadRoomsForActiveTeam,
    switchTeam, createTeam, joinTeam, leaveTeam, deleteTeam, updateTeam,
    removeMember, changeMemberRole, regenerateInviteCode, updateMemberHR,
    grantTeamOwner, revokeTeamOwner, transferTeamOwnership,
    activeTeamSessions, loadActiveTeamSessions,
    teamSounds, addTeamSound, renameTeamSound, removeTeamSound,
    teamSoundsAdminOnly, canUploadTeamSound, canManageTeamSound,
  } = useTeam();
  const { settings, session } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const location = useLocation();

  // Scroll to a hash target (e.g. /team#rooms) once the page has
  // rendered. React Router doesn't auto-scroll on hash, so we do it
  // ourselves after content is laid out.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);
  }, [location.hash, teamLoading]);
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState("manage"); // "manage" | "create" | "join"
  const [newTeamName, setNewTeamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copiedInvite, copyInvite] = useCopyToClipboard(2000);
  // Which org_team's member-management modal is open. Null = none.
  const [hrMember, setHrMember] = useState(null);
// Per-member team-management modal — "what teams is Jacob on?". The
  // team-centric "who's in SWE?" lives in the People filter now.
  const [memberTeamsModalFor, setMemberTeamsModalFor] = useState(null);
  const [managerModalFor, setManagerModalFor] = useState(null);
  const [memberToRemove, setMemberToRemove] = useState(null);
  // Open the unified RoomSettingsModal — triggered both from the floor
  // plan editor (click a tile in edit mode) and from the Rooms list
  // below (the Edit button on each row).
  const [roomToEdit, setRoomToEdit] = useState(null);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);

  // People filter + search. Source of truth lives in URL params so an
  // admin can deep-link to e.g. "/team?team=<id>&q=jacob" and the Teams
  // card can drive the same state without prop-drilling.
  const teamFilter = searchParams.get("team") || "all"; // "all" | "unassigned" | <orgTeam.id>
  const memberSearch = searchParams.get("q") || "";
  function updateParam(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }
  function setTeamFilter(v) { updateParam("team", v); }
  function setMemberSearch(v) { updateParam("q", v); }
  const peopleSectionRef = useRef(null);
  const orgPageFromHash = (() => {
    const id = location.hash.slice(1);
    return ["people", "rooms", "goals", "settings"].includes(id) ? id : null;
  })();
  const canManageRooms = isAdmin || (myOrgTeamLeadIds?.size ?? 0) > 0;
  // Which org page the side nav is showing (persisted). Hash deep links and
  // People filters win over the stored page so shared links open the intended
  // sub-page instead of whatever page was last viewed.
  const hasPeopleQuery = () => !!(searchParams.get("team") || searchParams.get("q"));
  const [orgPage, setOrgPageRaw] = useState(() => {
    try {
      if (orgPageFromHash) return orgPageFromHash;
      if (hasPeopleQuery()) return "people";
      const v = localStorage.getItem("ql_team_page");
      return ["people", "rooms", "goals", "settings"].includes(v) ? v : "people";
    } catch { return "people"; }
  });
  const setOrgPage = (p) => {
    if (p !== orgPage && typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    // Leaving People drops its filter params so they don't linger in the URL of
    // another page (and so a reload there doesn't bounce back to People).
    if (p !== "people" && hasPeopleQuery()) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("team");
        next.delete("q");
        return next;
      }, { replace: true });
    }
    setOrgPageRaw(p);
    try { localStorage.setItem("ql_team_page", p); } catch { /* */ }
  };
  // A People filter arriving via in-app navigation (params change while mounted)
  // also switches to People. Not persisted — it's a one-off view, not a
  // preference change. (setOrgPage clears the params on leave, so no bounce.)
  useEffect(() => {
    if (hasPeopleQuery() && orgPage !== "people") setOrgPageRaw("people");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  useEffect(() => {
    if (orgPageFromHash) setOrgPageRaw((page) => (page === orgPageFromHash ? page : orgPageFromHash));
  }, [orgPageFromHash]);
  const orgPageEff = (orgPage === "rooms" && !canManageRooms) ? "people" : orgPage;
  function focusPeopleSection() {
    requestAnimationFrame(() => {
      peopleSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

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
    await copyInvite(activeTeam.invite_code, "code");
  }

  async function handleCopyLink() {
    if (!activeTeam?.invite_code) return;
    const link = `${getShareableBaseUrl()}/team/join/${activeTeam.invite_code}`;
    await copyInvite(link, "link");
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
      ? "border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg shadow-black/20"
      : "bg-white border-slate-200 shadow-sm"
  }`;
  const labelCls = `text-xs font-medium uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`;
  const headingCls = `text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`;
  const subCls = `text-sm ${dark ? "text-slate-400" : "text-slate-500"}`;
  const inputCls = dark
    ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
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
    <main className="px-4 pt-6 pb-24 max-w-[1000px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--color-accent-light)]">
            <Users className="w-5 h-5 text-[var(--color-accent)]" />
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
                <Timer className="w-4 h-4 text-[var(--color-accent)]" />
              </div>
              <div className="space-y-2">
                {activeTeamSessions.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                      dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <MemberIdentity
                        userId={s.leader_id}
                        fallbackName={s.leader_name}
                        fallbackAvatarUrl={s.leader_avatar}
                        size={32}
                        showFollow
                      />
                      <p className={`text-xs mt-0.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
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

          {/* Side nav (rail on desktop, chips on mobile) switches between grouped
              PAGES; the content column renders only the active page's sections. */}
          <div className="lg:flex lg:gap-6 lg:items-start">
            <TeamSideNav
              dark={dark}
              isAdmin={isAdmin}
              canManageRooms={canManageRooms}
              page={orgPageEff}
              onSelect={setOrgPage}
            />
            <div className="min-w-0 flex-1 space-y-6">

          {/* ─── ORG CHART (People) ──────────────────────────────── */}
          {orgPageEff === "people" && <OrgChart dark={dark} />}

          {/* ─── ORG PROJECTS (Goals) ────────────────────────────── */}
          {orgPageEff === "goals" && <OrgProjects dark={dark} />}

          {/* ─── DEPARTMENT GOALS (Goals) ────────────────────────── */}
          {orgPageEff === "goals" && <TeamGoals dark={dark} />}

          {/* ─── INVITE (People) ─────────────────────────────────── */}
          {orgPageEff === "people" && (
          <InviteCard
            dark={dark}
            team={activeTeam}
            isAdmin={isAdmin}
            onCopyCode={handleCopyCode}
            onCopyLink={handleCopyLink}
            onRegenerate={handleRegenerateCode}
            copiedCode={copiedInvite === "code"}
            copiedLink={copiedInvite === "link"}
            memberCount={teamMembers.length}
          />
          )}

          {/* ─── ORG PROFILE (Settings) ──────────────────────────── */}
          {orgPageEff === "settings" && isAdmin && (
            <SectionHeader
              icon={Building2}
              title="Org"
              subtitle="Profile and how others join"
              dark={dark}
            />
          )}

          {/* Team Settings (admin only) — name, icon, accent color */}
          {orgPageEff === "settings" && isAdmin && (
            <TeamSettingsCard
              key={activeTeam.id}
              team={activeTeam}
              dark={dark}
              cardCls={cardCls}
              labelCls={labelCls}
              inputCls={inputCls}
              onSave={(patch) => updateTeam(activeTeam.id, patch)}
              onUploadIcon={async (file) => {
                // Auto-compress raster images; SVGs pass through unchanged.
                let toUpload = file;
                if (file && file.type && file.type !== "image/svg+xml") {
                  try { toUpload = await compressImage(file); } catch { /* fall back to raw */ }
                }
                return uploadTeamIcon(toUpload, activeTeam.id);
              }}
              onDeleteIcon={async (url) => deleteTeamIcon(url)}
              onSuccess={(msg) => { setSuccess(msg); setTimeout(() => setSuccess(""), 3000); }}
              onError={(msg) => setError(msg)}
            />
          )}

          {/* Device accounts (admin only) — shared kiosks pinned to a room.
              Grouped with Rooms since you set them up together. */}
          {orgPageEff === "rooms" && isAdmin && <OrgDevicesPanel orgId={activeTeamId} />}

          {/* Org-shared pomodoro sounds (Goals page — with projects/goals). Every
              member sees the list and can pick one inside the timer's Sound panel;
              whether they can upload depends on the team's sounds_admin_only flag. */}
          {orgPageEff === "goals" && (
          <TeamSoundsCard
            dark={dark}
            cardCls={cardCls}
            labelCls={labelCls}
            isAdmin={isAdmin}
            teamName={activeTeam.name}
            adminOnly={teamSoundsAdminOnly}
            canUpload={canUploadTeamSound}
            sounds={teamSounds || []}
            canManageSound={canManageTeamSound}
            onToggleAdminOnly={async () => {
              const next = !teamSoundsAdminOnly;
              const { error } = await updateTeam(activeTeam.id, { sounds_admin_only: next });
              if (error) setError(error.message);
              else { setSuccess(next ? "Only admins can upload sounds now" : "Members can upload sounds now"); setTimeout(() => setSuccess(""), 2500); }
            }}
            onAdd={async (file) => {
              const r = await addTeamSound(file);
              if (r.error) setError(r.error.message || "Upload failed");
              else { setSuccess("Sound added"); setTimeout(() => setSuccess(""), 2000); }
            }}
            onRename={async (id, name) => {
              const r = await renameTeamSound(id, name);
              if (r.error) setError(r.error.message);
            }}
            onRemove={async (sound) => {
              const r = await removeTeamSound(sound);
              if (r.error) setError(r.error.message);
            }}
            onError={(msg) => setError(msg)}
          />
          )}

          {/* ─── TEAMS / DEPARTMENTS (People) ────────────────────── */}
          {orgPageEff === "people" && isAdmin && (
            <SectionHeader
              icon={Users2}
              title="Teams"
              subtitle="SWE, PM, HR — gate rooms and goals"
              dark={dark}
            />
          )}

          {/* OrgTeamsCard — only org admins */}
          {orgPageEff === "people" && isAdmin && (
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
              onManageMembers={(t) => { setTeamFilter(t.id); focusPeopleSection(); }}
            />
          )}

          {/* ─── OFFICE / ROOMS (Rooms) ─────────────────────────── */}
          {orgPageEff === "rooms" && canManageRooms && (
            <>
              <span id="rooms" className="block scroll-mt-24" aria-hidden="true" />
              <SectionHeader
                icon={Briefcase}
                title="Office"
                subtitle="Drag rooms to lay out the floor plan, resize from the corner. Rename, regate, or archive below."
                dark={dark}
              />
              <div className={cardCls}>
                <div className="flex items-center justify-end mb-3">
                  <Button
                    size="sm"
                    data-tour="create-room"
                    onClick={() => setShowCreateRoom(true)}
                    className="h-7 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> New room
                  </Button>
                </div>
                <OfficeLayoutEditor
                  rooms={(rooms || []).filter((r) => !r.archived_at)}
                  readOnly={false}
                  vibe={activeTeam?.office_vibe || "quiet"}
                  busy={false}
                  onJoinRoom={() => {}}
                  onOpenRoom={setRoomToEdit}
                  sessionByRoomId={new Map()}
                />
              </div>
              <RoomsAdminCard
                dark={dark}
                cardCls={cardCls}
                rooms={rooms || []}
                orgTeams={orgTeams || []}
                isAdmin={isAdmin}
                myOrgTeamLeadIds={myOrgTeamLeadIds || new Set()}
                onError={(msg) => setError(msg)}
                onSuccess={(msg) => { setSuccess(msg); setTimeout(() => setSuccess(""), 3000); }}
                onReload={loadRoomsForActiveTeam}
                onEdit={setRoomToEdit}
              />
            </>
          )}

          {/* ─── PEOPLE (People) ─────────────────────────────────── */}
          {orgPageEff === "people" && (() => {
            // Aggregate stats over the full org (not filtered) — these
            // are org-health numbers; filtering shouldn't make them lie.
            const adminCount = teamMembers.filter((m) => m.role === "admin").length;
            const unassignedCount = teamMembers.filter((m) =>
              (teamsByUserId.get(m.user_id) || []).length === 0,
            ).length;
            const q = memberSearch.trim().toLowerCase();
            const activeTeamObj = orgTeams.find((t) => t.id === teamFilter);

            // Apply filter then search. Search matches across name and
            // the names of any teams the person is on, so "swe sarah"
            // works as a single query when the team filter is "all".
            const filtered = teamMembers.filter((m) => {
              const userTeams = teamsByUserId.get(m.user_id) || [];
              if (teamFilter === "unassigned") {
                if (userTeams.length > 0) return false;
              } else if (teamFilter !== "all") {
                if (!userTeams.some((t) => t.id === teamFilter)) return false;
              }
              if (!q) return true;
              const haystack = [
                m.name || "",
                ...userTeams.map((t) => t.name || ""),
              ].join(" ").toLowerCase();
              return haystack.includes(q);
            });

            const filterActive = teamFilter !== "all" || q.length > 0;
            const subtitle = filterActive
              ? `Showing ${filtered.length} of ${teamMembers.length} in ${activeTeam.name}`
              : `${teamMembers.length} ${teamMembers.length === 1 ? "person" : "people"} in ${activeTeam.name}`;

            return (
              <>
                <span id="people" className="block scroll-mt-24" aria-hidden="true" />
                <SectionHeader
                  icon={Users}
                  title="People"
                  subtitle={subtitle}
                  dark={dark}
                />
                <div ref={peopleSectionRef} className={cardCls}>
                  {/* Health stats — at-a-glance numbers. Click
                      "unassigned" to jump straight into that filter. */}
                  <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 px-1 text-xs ${
                    dark ? "text-slate-400" : "text-slate-500"
                  }`}>
                    {[
                      { label: "people", value: teamMembers.length, onClick: () => setTeamFilter("all") },
                      { label: adminCount === 1 ? "admin" : "admins", value: adminCount },
                      { label: orgTeams.length === 1 ? "team" : "teams", value: orgTeams.length },
                      {
                        label: "unassigned",
                        value: unassignedCount,
                        accent: unassignedCount > 0,
                        onClick: unassignedCount > 0 ? () => setTeamFilter("unassigned") : undefined,
                      },
                    ].map((s, i) => {
                      const node = (
                        <span className="inline-flex items-baseline gap-1">
                          {i > 0 && <span className="opacity-40">·</span>}
                          <span className={`font-bold text-sm ${
                            s.accent
                              ? dark ? "text-amber-300" : "text-amber-600"
                              : dark ? "text-slate-200" : "text-slate-700"
                          }`}>
                            {s.value}
                          </span>
                          <span>{s.label}</span>
                        </span>
                      );
                      return s.onClick ? (
                        <button key={s.label} type="button" onClick={s.onClick} className="hover:underline">
                          {node}
                        </button>
                      ) : (
                        <span key={s.label}>{node}</span>
                      );
                    })}
                  </div>

                  {/* Filter chip strip. Horizontally scrollable so we
                      degrade gracefully on small screens / many teams. */}
                  <div className="-mx-1 px-1 mb-2 overflow-x-auto">
                    <div className="flex items-center gap-1.5 min-w-max">
                      <FilterChip
                        label="All"
                        active={teamFilter === "all"}
                        count={teamMembers.length}
                        dark={dark}
                        onClick={() => setTeamFilter("all")}
                      />
                      {orgTeams.map((t) => {
                        const count = teamMembers.filter((m) =>
                          (teamsByUserId.get(m.user_id) || []).some((tt) => tt.id === t.id),
                        ).length;
                        return (
                          <FilterChip
                            key={t.id}
                            label={t.name}
                            color={t.color}
                            active={teamFilter === t.id}
                            count={count}
                            dark={dark}
                            onClick={() => setTeamFilter(t.id)}
                          />
                        );
                      })}
                      <FilterChip
                        label="Unassigned"
                        active={teamFilter === "unassigned"}
                        count={unassignedCount}
                        accent={unassignedCount > 0}
                        dark={dark}
                        onClick={() => setTeamFilter("unassigned")}
                      />
                    </div>
                  </div>

                  {/* Search input */}
                  <div className={`relative mb-3`}>
                    <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${
                      dark ? "text-slate-500" : "text-slate-400"
                    }`} />
                    <Input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search by name or team…"
                      className={`pl-8 pr-8 h-9 text-sm ${inputCls}`}
                    />
                    {memberSearch && (
                      <button
                        type="button"
                        onClick={() => setMemberSearch("")}
                        className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded ${
                          dark ? "text-slate-400 hover:bg-slate-700/60" : "text-slate-500 hover:bg-slate-100"
                        }`}
                        aria-label="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Active filter hint — only shown when filter is on,
                      gives users a one-click escape. */}
                  {filterActive && (
                    <div className={`flex items-center justify-between mb-2 px-1 text-[11px] ${
                      dark ? "text-slate-400" : "text-slate-500"
                    }`}>
                      <span>
                        {teamFilter === "unassigned" && "Filtered to people without a team"}
                        {teamFilter !== "all" && teamFilter !== "unassigned" && activeTeamObj &&
                          `Filtered to ${activeTeamObj.name}`}
                        {teamFilter === "all" && q && `Searching "${q}"`}
                        {teamFilter !== "all" && q && ` · matching "${q}"`}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setTeamFilter("all"); setMemberSearch(""); }}
                        className="underline font-medium"
                      >
                        Clear
                      </button>
                    </div>
                  )}

                  <div className="space-y-2">
                    {filtered.length === 0 ? (
                      <div className={`text-center py-8 text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}>
                        {q
                          ? `No matches for "${q}".`
                          : teamFilter === "unassigned"
                            ? "Everyone is on at least one team."
                            : "No one in this team yet."}
                      </div>
                    ) : (
                      filtered.map((m) => (
                        <MemberCard
                          key={m.user_id}
                          member={m}
                          dark={dark}
                          isAdmin={isAdmin}
                          isOwner={!!m.is_owner}
                          viewerIsOwner={isOwner}
                          viewerUserId={session?.user?.id}
                          teamsForUser={teamsByUserId.get(m.user_id) || []}
                          onEditHR={() => setHrMember(m)}
                          onEditTeams={() => setMemberTeamsModalFor(m)}
                          onSetManager={() => setManagerModalFor(m)}
                          onToggleRole={() => handleToggleRole(m.user_id, m.role)}
                          onRemove={() => setMemberToRemove(m)}
                          onGrantOwner={async () => {
                            const { error } = await grantTeamOwner(activeTeamId, m.user_id);
                            if (error) alert(error.message || "Could not promote");
                          }}
                          onRevokeOwner={async () => {
                            const { error } = await revokeTeamOwner(activeTeamId, m.user_id);
                            if (error) alert(error.message || "Could not demote");
                          }}
                          onTransferOwnership={async () => {
                            const ok = window.confirm(
                              `Transfer ownership of "${activeTeam?.name}" to ${m.name}?\n\n`
                              + `You will keep your admin role but no longer be an owner. `
                              + `This can be reversed by the new owner.`
                            );
                            if (!ok) return;
                            const { error } = await transferTeamOwnership(activeTeamId, m.user_id);
                            if (error) alert(error.message || "Could not transfer");
                          }}
                          onTeamChipClick={(teamId) => {
                            setTeamFilter(teamId);
                            focusPeopleSection();
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              </>
            );
          })()}

          {/* ─── QUICK LINKS ─────────────────────────────────────── */}
          <SectionHeader
            icon={ArrowRight}
            title="Quick links"
            subtitle="Jump to timesheets and live sessions"
            dark={dark}
          />
          {isAdmin && (
            <button
              onClick={() => navigate("/team/timesheets")}
              className={`w-full ${cardCls} flex items-center justify-between hover:border-[var(--color-accent)] transition-colors cursor-pointer`}
            >
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 text-[var(--color-accent)]" />
                <div className="text-left">
                  <p className={headingCls}>Team Timesheets</p>
                  <p className={subCls}>View and export member timesheets</p>
                </div>
              </div>
              <ArrowRight className={`w-5 h-5 ${dark ? "text-slate-500" : "text-slate-400"}`} />
            </button>
          )}

          {/* ─── DANGER (Settings) ───────────────────────────────── */}
          {orgPageEff === "settings" && (
          <>
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
            </div>{/* content column */}
          </div>{/* two-column flex + side nav */}
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


      <MemberHRModal
        open={!!hrMember}
        onClose={() => setHrMember(null)}
        member={hrMember}
        onSave={async (patch) => {
          if (!hrMember || !activeTeamId) return { error: { message: "No member selected" } };
          return await updateMemberHR(activeTeamId, hrMember.user_id, patch);
        }}
      />

      <MemberManagerModal
        open={!!managerModalFor}
        onClose={() => setManagerModalFor(null)}
        member={managerModalFor}
        members={teamMembers}
        currentManagerId={managerModalFor?.manager_id || ""}
        nameOf={(mm) => mm.name || "Member"}
        onSave={async (managerId) => {
          if (!managerModalFor || !activeTeamId) return { error: { message: "No member selected" } };
          const res = await setMemberManager(activeTeamId, managerModalFor.user_id, managerId);
          if (!res.error) await loadMembers?.();
          return res;
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
        currentLeadTeamIds={
          memberTeamsModalFor
            ? (teamsByUserId.get(memberTeamsModalFor.user_id) || [])
                .filter((t) => t.role === "lead")
                .map((t) => t.id)
            : []
        }
        onChange={() => {
          // Realtime usually catches this via the org_team_members
          // subscription in TeamContext, but kick a manual refresh too
          // so the chip strip on the row updates the same tick.
          loadOrgTeamsForActive?.();
        }}
      />

      <RemoveMemberModal
        open={!!memberToRemove}
        onClose={() => { if (!removeBusy) setMemberToRemove(null); }}
        member={memberToRemove}
        orgName={activeTeam?.name || "this org"}
        busy={removeBusy}
        onConfirm={async () => {
          if (!memberToRemove || !activeTeamId) return;
          setRemoveBusy(true);
          await handleRemoveMember(memberToRemove.user_id);
          setRemoveBusy(false);
          setMemberToRemove(null);
        }}
      />

      <CreateRoomModal
        open={showCreateRoom}
        onClose={() => setShowCreateRoom(false)}
        teamId={activeTeamId}
        userId={session?.user?.id}
        isAdmin={isAdmin}
        onCreated={() => loadRoomsForActiveTeam?.()}
      />

      <RoomSettingsModal
        open={!!roomToEdit}
        room={roomToEdit}
        orgTeams={orgTeams || []}
        isAdmin={isAdmin}
        myOrgTeamLeadIds={myOrgTeamLeadIds || new Set()}
        onClose={() => setRoomToEdit(null)}
        onSaved={(msg) => {
          setRoomToEdit(null);
          setSuccess(msg);
          setTimeout(() => setSuccess(""), 3000);
          loadRoomsForActiveTeam?.();
        }}
        onError={(msg) => setError(msg)}
      />
    </main>
  );
}

// Small section header. Used to group the page (Org → Teams →
// Members → Quick links → Danger) so admins don't see one tall stack
// of cards with no semantic structure.
// In-page navigation for the (long) org page: a sticky rail on desktop, a
// horizontal chip scroller on mobile. Links jump to anchor spans placed before
// each section; an IntersectionObserver highlights whichever section you're in.
// The org page is split into a few PAGES, grouped by what you edit together, and
// the side nav switches between them — a page renders only its own sections, so
// it's no longer one giant scroll:
//   • People   — org chart, departments, and the member roster (who's in the
//                org + what team they're on).
//   • Rooms    — the office floor plan, rooms, and kiosk devices.
//   • Goals    — projects, goals, and org pomodoro sounds.
//   • Settings — org profile / invite / delete (admins).
const TEAM_PAGES = [
  { id: "people", label: "People", Icon: Users },
  { id: "rooms", label: "Rooms", Icon: Building2, roomsOnly: true },
  { id: "goals", label: "Goals", Icon: Target },
  // Visible to all: org profile is admin-gated inside, but everyone needs the
  // Danger zone here to LEAVE the org.
  { id: "settings", label: "Settings", Icon: SettingsIcon },
];

function TeamSideNav({ dark, isAdmin, canManageRooms, page, onSelect }) {
  const pages = useMemo(
    () => TEAM_PAGES.filter((p) => (!p.adminOnly || isAdmin) && (!p.roomsOnly || canManageRooms)),
    [canManageRooms, isAdmin],
  );
  const linkCls = (id) =>
    `inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
      page === id
        ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
        : dark ? "text-slate-400 hover:text-slate-200 hover:bg-white/5" : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
    }`;
  return (
    <>
      {/* Desktop: sticky vertical rail */}
      <nav className="hidden lg:flex lg:flex-col gap-0.5 sticky top-20 w-40 shrink-0 self-start">
        {pages.map(({ id, label, Icon }) => (
          <button key={id} type="button" onClick={() => onSelect(id)} aria-current={page === id ? "page" : undefined} className={`w-full justify-start ${linkCls(id)}`}>
            <Icon className="w-4 h-4 shrink-0" /> {label}
          </button>
        ))}
      </nav>
      {/* Mobile: sticky horizontal chip scroller under the app nav */}
      <nav
        className={`lg:hidden sticky z-20 -mx-4 px-4 py-1.5 flex gap-1.5 overflow-x-auto backdrop-blur ${
          dark ? "bg-[var(--color-bg)]/80" : "bg-white/80"
        }`}
        style={{ top: "calc(env(safe-area-inset-top) + var(--nav-h))" }}
      >
        {pages.map(({ id, label, Icon }) => (
          <button key={id} type="button" onClick={() => onSelect(id)} aria-current={page === id ? "page" : undefined} className={`shrink-0 ${linkCls(id)}`}>
            <Icon className="w-4 h-4 shrink-0" /> {label}
          </button>
        ))}
      </nav>
    </>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, dark, danger = false }) {
  return (
    <div className="flex items-start gap-2.5 px-1 pt-3">
      <div
        className={`p-1.5 rounded-lg shrink-0 ${
          danger
            ? dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"
            : "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
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
  member: m, dark, isAdmin, isOwner, viewerIsOwner, viewerUserId,
  teamsForUser, onEditHR, onEditTeams, onSetManager, onToggleRole, onRemove, onTeamChipClick,
  onGrantOwner, onRevokeOwner, onTransferOwnership,
}) {
  const isSelf = viewerUserId === m.user_id;
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
  const roleLabel = m.role === "admin" ? (isOwner ? "Owner" : "Admin") : "Member";
  // A lead in any org_team gets a violet "Lead" badge alongside the
  // org-level role pill. Distinct purpose from admin: leads scope to
  // a specific team's rooms + retros, not to the whole org.
  const leadTeams = (teamsForUser || []).filter((t) => t.role === "lead");
  const isLead = leadTeams.length > 0;
  const leadTitle = isLead
    ? `Lead of ${leadTeams.map((t) => t.name).join(", ")}`
    : "";
  const compParts = [];
  if (m.classification === "salary") compParts.push("Salary");
  else if (m.classification === "hourly") {
    compParts.push(`Hourly${m.hourly_rate ? ` · $${Number(m.hourly_rate).toFixed(0)}/hr` : ""}`);
  }

  return (
    <div className={`rounded-xl px-3 py-3 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50"}`}>
      {/* Row 1: identity + actions */}
      <div className="flex items-start gap-3">
        {/* Avatar with presence ring. Admin status is shown in the
            tagline and (for editable rows) in the role dropdown — the
            crown overlay used to add a third signal that just made the
            row noisier. */}
        <div className={`relative shrink-0 rounded-full ring-2 ring-offset-2 ${presenceRing} ${
          dark ? "ring-offset-slate-800/40" : "ring-offset-slate-50"
        }`}>
          <UserAvatar url={m.avatar_url} name={m.name} size={40} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {m.name}
            </p>
            {/* Role pill — prominent, since the crown overlay is gone.
                Owner gets the strongest treatment, admin a softer one,
                regular member is implicit (no pill at all). */}
            {m.role === "admin" && (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  isOwner
                    ? dark ? "bg-amber-400/15 text-amber-300" : "bg-amber-100 text-amber-700"
                    : "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                }`}
              >
                <Crown className="w-2.5 h-2.5" fill="currentColor" />
                {roleLabel}
              </span>
            )}
            {isLead && (
              <span
                title={leadTitle}
                className={`inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  dark ? "bg-violet-500/15 text-violet-300" : "bg-violet-100 text-violet-700"
                }`}
              >
                <Star className="w-2.5 h-2.5" fill="currentColor" />
                Lead
              </span>
            )}
          </div>
          <p className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {presenceLabel}
            {m.status ? ` · ${m.status}` : ""}
            {" · "}Joined {joinedDate}
          </p>
          {compParts.length > 0 && (
            <p className={`text-[11px] mt-0.5 truncate ${dark ? "text-slate-300" : "text-slate-600"}`}>
              {compParts.join(" · ")}
            </p>
          )}
        </div>

        {/* Admin actions. Inline: role dropdown (a primary,
            understandable axis of control). Behind kebab: Comp + Teams
            (less frequent) and the destructive Remove (kept off the
            role dropdown so role-change isn't co-located with destroy). */}
        {isAdmin && (
          <div className="flex items-center gap-1.5 shrink-0 justify-end">
            {!isOwner ? (
              <Select
                value={m.role === "admin" ? "admin" : "member"}
                onValueChange={(v) => { if (v !== m.role) onToggleRole(); }}
              >
                <SelectTrigger
                  className={`h-7 text-xs px-2 w-auto gap-1 ${
                    dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-200" : "bg-white"
                  }`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-1 ${
                dark ? "text-slate-500" : "text-slate-400"
              }`}>
                Owner
              </span>
            )}
            <MemberActionsMenu
              dark={dark}
              canRemove={!isOwner}
              onEditComp={onEditHR}
              onEditTeams={onEditTeams}
              onSetManager={onSetManager}
              onRemove={onRemove}
              viewerIsOwner={viewerIsOwner}
              targetIsOwner={isOwner}
              targetIsSelf={isSelf}
              onGrantOwner={onGrantOwner}
              onRevokeOwner={onRevokeOwner}
              onTransferOwnership={onTransferOwnership}
            />
          </div>
        )}
      </div>

      {/* Row 2: team chips */}
      {(teamsForUser.length > 0 || isAdmin) && (
        <div className={`mt-3 pt-2.5 border-t ${dark ? "border-[var(--color-border-light)]" : "border-slate-200/70"} flex flex-wrap items-center gap-1.5`}>
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
          {teamsForUser.map((t) => {
            // Chips drill into the team filter when handler is provided
            // — so "show me everyone on PM" is one click from any row.
            const chipStyle = {
              background: `${t.color}22`,
              color: dark ? "#fff" : t.color,
              border: `1px solid ${t.color}55`,
            };
            const inner = (
              <>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </>
            );
            return onTeamChipClick ? (
              <button
                key={t.id}
                type="button"
                onClick={() => onTeamChipClick(t.id)}
                title={`Show only ${t.name}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full transition-transform hover:scale-[1.03]"
                style={chipStyle}
              >
                {inner}
              </button>
            ) : (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={chipStyle}
              >
                {inner}
              </span>
            );
          })}
          {isAdmin && (
            <button
              type="button"
              onClick={onEditTeams}
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border border-dashed transition-colors ${
                dark
                  ? "border-slate-600 text-slate-400 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  : "border-slate-300 text-slate-500 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
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

// Small pill used in the People filter chip strip. Active state uses
// the team's accent color when supplied so admins can spot "filtered
// to PM" by color even before reading the label.
function FilterChip({ label, count, color, active, accent, dark, onClick }) {
  const ring = color || (dark ? "#94a3b8" : "#64748b");
  const baseCls = "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors";
  const stateCls = active
    ? "shadow-sm"
    : dark
      ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-300 hover:bg-slate-800/80"
      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300";
  const activeStyle = active
    ? {
        background: color ? `${color}22` : (dark ? "#0f172a" : "#0f172a"),
        borderColor: color ? `${color}99` : "transparent",
        color: color ? (dark ? "#fff" : color) : "#fff",
      }
    : undefined;

  return (
    <button type="button" onClick={onClick} className={`${baseCls} ${stateCls}`} style={activeStyle}>
      {color && (
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: ring }} />
      )}
      <span>{label}</span>
      <span
        className={`px-1 rounded text-[10px] font-bold ${
          active
            ? "bg-black/15"
            : accent
              ? dark ? "bg-amber-400/15 text-amber-300" : "bg-amber-100 text-amber-700"
              : dark ? "bg-slate-700/50 text-slate-400" : "bg-slate-100 text-slate-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// Kebab overflow menu for less-frequent member actions. We close on
// outside click and Escape — the standard expectations. Lives inline
// (not a portal) because the row clipping isn't an issue at our card
// widths; if we hit overflow later we can lift it into a Popover.
function MemberActionsMenu({
  dark, canRemove, onEditComp, onEditTeams, onSetManager, onRemove,
  viewerIsOwner, targetIsOwner, targetIsSelf,
  onGrantOwner, onRevokeOwner, onTransferOwnership,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemCls = `flex items-center gap-2 w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
    dark ? "text-slate-200 hover:bg-slate-700/60" : "text-slate-700 hover:bg-slate-100"
  }`;
  const destructiveCls = `flex items-center gap-2 w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
    dark ? "text-red-300 hover:bg-red-500/15" : "text-red-600 hover:bg-red-50"
  }`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Member actions"
        className={`h-7 w-7 rounded-md border inline-flex items-center justify-center transition-colors ${
          dark
            ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-300 hover:bg-slate-700/60"
            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
        }`}
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute right-0 top-full mt-1 z-40 min-w-[160px] rounded-lg border shadow-lg overflow-hidden py-1 ${
            dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)]" : "bg-white border-slate-200"
          }`}
        >
          <button
            type="button"
            role="menuitem"
            className={itemCls}
            onClick={() => { setOpen(false); onEditComp(); }}
          >
            <DollarSign className="w-3.5 h-3.5 opacity-70" />
            Edit comp
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemCls}
            onClick={() => { setOpen(false); onEditTeams(); }}
          >
            <Users2 className="w-3.5 h-3.5 opacity-70" />
            Edit teams
          </button>
          {onSetManager && (
            <button
              type="button"
              role="menuitem"
              className={itemCls}
              onClick={() => { setOpen(false); onSetManager(); }}
            >
              <GitBranch className="w-3.5 h-3.5 opacity-70" />
              Set manager
            </button>
          )}

          {/* Owner-only actions. Grant + Transfer hidden for self
              (you can't promote/transfer to yourself); Revoke hidden
              for non-owners and for the viewer (revoking your own
              ownership goes through Transfer instead). */}
          {viewerIsOwner && !targetIsSelf && !targetIsOwner && (
            <button
              type="button"
              role="menuitem"
              className={itemCls}
              onClick={() => { setOpen(false); onGrantOwner?.(); }}
            >
              <Crown className="w-3.5 h-3.5 opacity-70" />
              Make co-owner
            </button>
          )}
          {viewerIsOwner && !targetIsSelf && targetIsOwner && (
            <button
              type="button"
              role="menuitem"
              className={itemCls}
              onClick={() => { setOpen(false); onRevokeOwner?.(); }}
            >
              <Crown className="w-3.5 h-3.5 opacity-70" />
              Remove as co-owner
            </button>
          )}
          {viewerIsOwner && !targetIsSelf && (
            <button
              type="button"
              role="menuitem"
              className={itemCls}
              onClick={() => { setOpen(false); onTransferOwnership?.(); }}
            >
              <ArrowRightLeft className="w-3.5 h-3.5 opacity-70" />
              Transfer ownership…
            </button>
          )}

          {canRemove && (
            <>
              <div className={`my-1 h-px ${dark ? "bg-slate-700/60" : "bg-slate-200"}`} />
              <button
                type="button"
                role="menuitem"
                className={destructiveCls}
                onClick={() => { setOpen(false); onRemove(); }}
              >
                <UserMinus className="w-3.5 h-3.5" />
                Remove from org…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Admin/lead card for renaming, regating, and archiving rooms. Pure
// list — drag/resize lives on the /pomodoro floor plan. Leads only see
// rooms gated to teams they lead (admins see all non-archived rooms).
function RoomsAdminCard({
  dark, cardCls, rooms, orgTeams, isAdmin, myOrgTeamLeadIds,
  onError, onSuccess, onReload, onEdit,
}) {
  const [busy, setBusy] = useState(null); // room id currently saving
  const [archiveConfirmId, setArchiveConfirmId] = useState(null);

  const visible = (rooms || []).filter((r) => {
    if (isAdmin) return true;
    const gating = r.room_teams || [];
    if (gating.length === 0) return false; // org-wide → admin-only management
    return gating.some((rt) => myOrgTeamLeadIds.has(rt.org_team_id));
  });

  async function commitArchive(room) {
    setBusy(room.id);
    const { error } = await archiveRoomV2(room.id);
    setBusy(null);
    setArchiveConfirmId(null);
    if (error) { onError?.(error.message || "Could not archive"); return; }
    onSuccess?.("Room archived");
    onReload?.();
  }

  if (visible.length === 0) {
    return (
      <div className={cardCls}>
        <p className={`text-sm italic ${dark ? "text-slate-400" : "text-slate-500"}`}>
          No rooms yet — create one with the New room button above.
        </p>
      </div>
    );
  }

  return (
    <div className={cardCls}>
      <div className="space-y-2">
        {visible.map((r) => {
          const gating = (r.room_teams || [])
            .map((rt) => orgTeams.find((t) => t.id === rt.org_team_id))
            .filter(Boolean);
          const rowBusy = busy === r.id;
          return (
            <div
              key={r.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50"
              }`}
            >
              {/* Color swatch instead of the generic Briefcase icon — at
                  a glance you can see which rooms share a category. */}
              <span
                className="w-3 h-3 rounded-md border border-black/10 shrink-0"
                style={{ background: r.color || "#14b8a6" }}
                title={r.color}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                  {r.name}
                  <span className={`ml-2 text-[10px] uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    {r.kind}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                  {gating.length === 0 ? (
                    <span className={`text-[11px] italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
                      Org-wide
                    </span>
                  ) : (
                    gating.map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{
                          background: `${t.color}22`,
                          color: dark ? "#fff" : t.color,
                          border: `1px solid ${t.color}55`,
                        }}
                      >
                        <span className="w-1 h-1 rounded-full" style={{ background: t.color }} />
                        {t.name}
                      </span>
                    ))
                  )}
                </div>
              </div>
              {/* Settings — one button replaces rename + gating */}
              <button
                type="button"
                onClick={() => onEdit?.(r)}
                title="Edit settings"
                disabled={rowBusy}
                className={`h-7 px-2 inline-flex items-center gap-1 text-xs rounded-md ${
                  dark ? "text-slate-300 hover:bg-slate-700/60" : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
              {/* Archive */}
              {archiveConfirmId === r.id ? (
                <span className="inline-flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setArchiveConfirmId(null)}
                    disabled={rowBusy}
                    className="h-7 text-[11px]"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => commitArchive(r)}
                    disabled={rowBusy}
                    className="h-7 text-[11px] bg-red-500 hover:bg-red-600 text-white"
                  >
                    {rowBusy ? "…" : "Archive"}
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setArchiveConfirmId(r.id)}
                  title="Archive"
                  disabled={rowBusy}
                  className={`h-7 w-7 inline-flex items-center justify-center rounded-md ${
                    dark ? "text-red-400 hover:bg-red-500/15" : "text-red-500 hover:bg-red-50"
                  }`}
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

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

function TeamSoundsCard({
  dark, cardCls, labelCls,
  isAdmin, teamName, adminOnly, canUpload, sounds,
  canManageSound,
  onToggleAdminOnly, onAdd, onRename, onRemove, onError,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const playingRef = useRef(null);
  const [playingId, setPlayingId] = useState(null);

  function togglePreview(sound) {
    if (playingId === sound.id) {
      if (playingRef.current) { try { playingRef.current.pause(); } catch { /* ignore */ } }
      playingRef.current = null;
      setPlayingId(null);
      return;
    }
    if (playingRef.current) { try { playingRef.current.pause(); } catch { /* ignore */ } }
    const audio = new Audio(sound.url);
    playingRef.current = audio;
    audio.addEventListener("ended", () => {
      if (playingRef.current === audio) { playingRef.current = null; setPlayingId(null); }
    });
    audio.play().then(() => setPlayingId(sound.id)).catch(() => onError?.("Couldn't play sound"));
  }

  function startRename(sound) {
    setRenamingId(sound.id);
    setRenameDraft(sound.name || "");
  }
  function commitRename() {
    const id = renamingId;
    const next = renameDraft.trim();
    setRenamingId(null);
    if (next) onRename?.(id, next);
  }

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    try { await onAdd?.(file); } finally { setUploading(false); }
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-3">
        <p className={labelCls}>Org Sounds</p>
        <Volume2 className="w-4 h-4 text-[var(--color-accent)]" />
      </div>
      <p className={`text-xs mb-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
        Sounds shared with the whole org — every member can pick them inside the timer's Sound panel.
      </p>

      {isAdmin && (
        <label className={`flex items-center gap-2 mb-4 text-xs cursor-pointer ${dark ? "text-slate-200" : "text-slate-700"}`}>
          <input
            type="checkbox"
            checked={!!adminOnly}
            onChange={onToggleAdminOnly}
            className="h-3.5 w-3.5"
            style={{ accentColor: "var(--color-accent)" }}
          />
          <span>Only admins can upload sounds</span>
          <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {adminOnly ? "(members can listen only)" : "(any member can upload)"}
          </span>
        </label>
      )}

      <div className="space-y-2 mb-3">
        {sounds.length === 0 && (
          <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {canUpload
              ? `No sounds yet. Upload one to share it with everyone in ${teamName}.`
              : `No sounds yet. Ask an admin to add one for ${teamName}.`}
          </p>
        )}
        {sounds.map((s) => {
          const canManage = canManageSound?.(s);
          return (
            <div
              key={s.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)]" : "bg-slate-50 border-slate-200"
              }`}
            >
              {renamingId === s.id ? (
                <Input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value.slice(0, 80))}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                  className="h-8 max-w-xs"
                  maxLength={80}
                />
              ) : (
                <p className={`flex-1 min-w-0 truncate text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>
                  {s.name || "Untitled sound"}
                </p>
              )}
              <button
                type="button"
                onClick={() => togglePreview(s)}
                className={`text-xs font-semibold px-2 py-1 rounded ${
                  dark ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                {playingId === s.id ? "Stop" : "Preview"}
              </button>
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => startRename(s)}
                    className={`text-xs font-semibold px-2 py-1 rounded ${
                      dark ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove?.(s)}
                    className={`text-xs px-2 py-1 rounded ${
                      dark ? "text-slate-400 hover:text-red-300" : "text-slate-500 hover:text-red-500"
                    }`}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {canUpload && (
        <FileDropZone
          accept={{ "audio/*": [] }}
          maxSize={5 * 1024 * 1024}
          uploading={uploading}
          buttonLabel="Upload sound"
          hint="Click or drop an audio file · MP3 / WAV / OGG / M4A / FLAC · up to 5 MB"
          onFile={handleFile}
          onReject={onError}
        />
      )}
    </div>
  );
}

function TeamSettingsCard({ team, dark, cardCls, labelCls, inputCls, onSave, onUploadIcon, onDeleteIcon, onSuccess, onError }) {
  const [nameDraft, setNameDraft] = useState(team.name || "");
  const [colorDraft, setColorDraft] = useState(team.color || "#14b8a6");
  const [iconUrl, setIconUrl] = useState(team.icon_url || "");
  const [vibeDraft, setVibeDraft] = useState(team.office_vibe || "quiet");
  const [autoJoinDraft, setAutoJoinDraft] = useState(!!team.channels_auto_join);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-sync drafts when switching teams.
  useEffect(() => {
    setNameDraft(team.name || "");
    setColorDraft(team.color || "#14b8a6");
    setIconUrl(team.icon_url || "");
    setVibeDraft(team.office_vibe || "quiet");
    setAutoJoinDraft(!!team.channels_auto_join);
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
    || vibeDraft !== (team.office_vibe || "quiet")
    || autoJoinDraft !== !!team.channels_auto_join;

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
      channels_auto_join: autoJoinDraft,
    });
    setBusy(false);
    if (error) { onError?.(error.message || "Could not save team settings."); return; }
    onSuccess?.("Team settings saved");
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-3">
        <p className={labelCls}>Team Settings</p>
        <Palette className="w-4 h-4 text-[var(--color-accent)]" />
      </div>

      <div className="space-y-4">
        <FileDropZone
          accept={{ "image/*": [] }}
          maxSize={25 * 1024 * 1024}
          uploading={uploading}
          buttonLabel={iconUrl ? "Replace icon" : "Upload icon"}
          hint="Click or drop an image · large photos auto-compress"
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
          <div className={`inline-flex rounded-lg p-0.5 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"}`}>
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

        {/* Auto-join channels — open channels appear for everyone without Browse. */}
        <div>
          <p className={labelCls}>Channels</p>
          <button type="button" onClick={() => setAutoJoinDraft((v) => !v)}
            className={`mt-1 w-full max-w-sm flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${autoJoinDraft ? "border-[var(--color-accent)]" : dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
            <span className="flex-1 min-w-0">
              <span className={`block text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>Add everyone to new channels</span>
              <span className={`block text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>Open channels show up for every member automatically — no need to Browse &amp; join.</span>
            </span>
            <span className={`shrink-0 w-9 h-5 rounded-full p-0.5 transition-colors ${autoJoinDraft ? "bg-[var(--color-accent)]" : dark ? "bg-white/15" : "bg-slate-300"}`}>
              <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${autoJoinDraft ? "translate-x-4" : ""}`} />
            </span>
          </button>
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
