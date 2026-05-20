import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users, Plus, LogIn, Copy, RefreshCw, Trash2, Crown, UserMinus,
  ChevronDown, FileSpreadsheet, ArrowRight,
} from "lucide-react";

export default function TeamPage() {
  const {
    teams, activeTeam, activeTeamId, teamMembers, teamLoading, isAdmin,
    switchTeam, createTeam, joinTeam, leaveTeam, deleteTeam,
    removeMember, changeMemberRole, regenerateInviteCode,
  } = useTeam();
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

  // Auto-join from URL
  useEffect(() => {
    const code = searchParams.get("join");
    if (code) {
      setJoinCode(code);
      setTab("join");
    }
  }, [searchParams]);

  // Show create/join if no teams
  useEffect(() => {
    if (!teamLoading && teams.length === 0) setTab("create");
  }, [teamLoading, teams.length]);

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
    const link = `${window.location.origin}/team?join=${activeTeam.invite_code}`;
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

  return (
    <main className="px-4 pt-6 pb-24 max-w-[720px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${dark ? "bg-cyan-500/10" : "bg-teal-50"}`}>
            <Users className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
          </div>
          <h1 className={`text-xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Teams</h1>
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
              >
                {t.name}
                {t.role === "admin" && <Crown className="w-3 h-3 ml-1.5 opacity-60" />}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Active Team Details */}
      {activeTeam && tab === "manage" && (
        <>
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

          {/* Timesheets Link (admin only) */}
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

          {/* Members */}
          <div className={cardCls}>
            <div className="flex items-center justify-between mb-4">
              <p className={labelCls}>Members ({teamMembers.length})</p>
              <Badge variant="outline" className="text-xs">
                {activeTeam.name}
              </Badge>
            </div>
            <div className="space-y-2">
              {teamMembers.map((m) => (
                <div
                  key={m.user_id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                    dark ? "bg-slate-800/40" : "bg-slate-50"
                  }`}
                >
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    dark ? "bg-cyan-500/20 text-cyan-400" : "bg-teal-100 text-teal-700"
                  }`}>
                    {(m.name || "?")[0].toUpperCase()}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${dark ? "text-slate-200" : "text-slate-700"}`}>
                      {m.name}
                    </p>
                    <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                      Joined {new Date(m.joined_at).toLocaleDateString()}
                    </p>
                  </div>
                  {/* Role badge */}
                  <Badge variant={m.role === "admin" ? "default" : "secondary"} className="text-[10px]">
                    {m.role === "admin" ? "Admin" : "Member"}
                  </Badge>
                  {/* Admin actions */}
                  {isAdmin && m.user_id !== activeTeam.created_by && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleToggleRole(m.user_id, m.role)}
                        title={m.role === "admin" ? "Demote to member" : "Promote to admin"}
                      >
                        <Crown className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                        onClick={() => handleRemoveMember(m.user_id)}
                        title="Remove member"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Danger Zone */}
          <div className={`${cardCls} border-red-500/20`}>
            <p className={`${labelCls} text-red-500`}>Danger Zone</p>
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
    </main>
  );
}
