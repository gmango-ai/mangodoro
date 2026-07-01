import { useEffect, useMemo, useState } from "react";
import { Network, Crown, Building2, LayoutGrid, List as ListIcon, GitBranch, Shield, Star, ChevronRight } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { useProfileCard } from "../../context/ProfileContext";
import { getProfiles } from "../../lib/profiles";
import UserAvatar from "../UserAvatar";

// "Who's who" — the org, viewable three ways (card by department · flat list ·
// reporting tree) with leadership surfaced up top. Job titles + reporting lines
// come from profiles / team_members.manager_id; click anyone to open their card.

const VIEW_KEY = "ql_orgchart_view";
const VIEWS = ["card", "list", "tree"];
function loadView() {
  try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : "card"; } catch { return "card"; }
}

export default function OrgChart({ dark }) {
  const { activeTeam, teamMembers = [], orgTeams = [], teamsByUserId } = useTeam();
  const { openProfile } = useProfileCard();
  const [profById, setProfById] = useState({});
  const [view, setViewRaw] = useState(loadView);

  const ids = useMemo(() => (teamMembers || []).map((m) => m.user_id), [teamMembers]);
  useEffect(() => {
    if (!ids.length) { setProfById({}); return; }
    getProfiles(ids).then(setProfById);
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map((teamMembers || []).map((m) => [m.user_id, m])), [teamMembers]);

  if (!activeTeam) return null;

  const setView = (v) => { setViewRaw(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* */ } };
  const surface = dark ? "var(--color-surface)" : "#fff";
  const border = dark ? "var(--color-border)" : "rgb(226,232,240)";

  const deptsOf = (uid) => teamsByUserId?.get(uid) || [];
  const nameOf = (m) => profById[m.user_id]?.display_name || m.name || "Member";
  const titleOf = (m) => profById[m.user_id]?.job_title || "";
  const avatarOf = (m) => profById[m.user_id]?.avatar_url || m.avatar_url || "";
  const isLeadAnywhere = (uid) => deptsOf(uid).some((t) => t.role === "lead");
  const open = (uid, e) => openProfile?.(uid, e.currentTarget.getBoundingClientRect());

  // Leadership tiers (from existing roles — no schema needed for this part).
  const owner = teamMembers.find((m) => m.is_owner) || null;
  const admins = teamMembers.filter((m) => m.role === "admin" && !m.is_owner);
  const leads = teamMembers.filter((m) => !m.is_owner && m.role !== "admin" && isLeadAnywhere(m.user_id));

  // A small role badge (owner > admin > lead), highest one shown.
  const RoleBadge = ({ m, dept }) => {
    const leadHere = dept ? deptsOf(m.user_id).some((t) => String(t.id) === String(dept.id) && t.role === "lead") : isLeadAnywhere(m.user_id);
    if (m.is_owner) return <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="currentColor" />;
    if (m.role === "admin") return <Shield className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />;
    if (leadHere) return <Star className="w-3.5 h-3.5 text-violet-400 shrink-0" fill="currentColor" />;
    return null;
  };

  // Shared clickable person row (avatar + name + title + role badge).
  const MemberRow = ({ m, dept = null, compact = false }) => (
    <button
      type="button"
      onClick={(e) => open(m.user_id, e)}
      className={`flex items-center gap-2 w-full text-left rounded-lg px-2 py-1.5 transition-colors ${dark ? "hover:bg-white/5" : "hover:bg-slate-50"}`}
    >
      <UserAvatar url={avatarOf(m)} name={nameOf(m)} size={compact ? 24 : 28} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>{nameOf(m)}</span>
        {titleOf(m) && <span className={`block text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>{titleOf(m)}</span>}
      </span>
      <RoleBadge m={m} dept={dept} />
    </button>
  );

  // ── Views ──────────────────────────────────────────────────────────────
  // A team's members as an overlapping avatar stack (the office presence-bar
  // idiom) inside a rectangular, color-washed card — image-forward, so you scan
  // "who's on this team" at a glance rather than reading a name list.
  const AV_MAX = 10;
  const TeamCard = ({ dept, members }) => {
    const tint = dept?.color || "#64748b";
    const leadIds = new Set(
      dept
        ? members.filter((m) => deptsOf(m.user_id).some((t) => String(t.id) === String(dept.id) && t.role === "lead")).map((m) => m.user_id)
        : [],
    );
    const leads = members.filter((m) => leadIds.has(m.user_id));
    const heading = dept ? dept.name : (orgTeams.length ? "Not in a department" : "Everyone");
    return (
      <div
        className={`rounded-xl border p-3 flex flex-col gap-2.5 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}
        style={{ background: dept ? `color-mix(in srgb, ${tint} 8%, ${surface})` : surface }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tint }} />
          <span className={`text-[13px] font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>{heading}</span>
          <span className={`ml-auto text-[11px] font-medium shrink-0 tabular-nums ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {members.length} {members.length === 1 ? "person" : "people"}
          </span>
        </div>
        {members.length === 0 ? (
          <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>No one yet.</p>
        ) : (
          <>
            <div className="flex items-center flex-wrap gap-y-1.5">
              {members.slice(0, AV_MAX).map((m) => {
                const lead = leadIds.has(m.user_id);
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={(e) => open(m.user_id, e)}
                    title={`${nameOf(m)}${titleOf(m) ? ` — ${titleOf(m)}` : ""}${lead ? " · lead" : ""}`}
                    className={`relative shrink-0 rounded-full ring-2 -ml-1.5 first:ml-0 transition-transform hover:-translate-y-0.5 hover:z-10 ${
                      lead ? "ring-[var(--color-accent)]" : dark ? "ring-[var(--color-surface)]" : "ring-white"
                    }`}
                  >
                    <UserAvatar url={avatarOf(m)} name={nameOf(m)} size={36} />
                    {lead && <Crown className="absolute -top-1.5 -right-1 w-3 h-3 text-amber-400 drop-shadow" fill="currentColor" />}
                  </button>
                );
              })}
              {members.length > AV_MAX && (
                <span className={`-ml-1.5 inline-flex items-center justify-center w-9 h-9 rounded-full text-[11px] font-semibold ring-2 ring-transparent ${dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-200 text-slate-700"}`}>
                  +{members.length - AV_MAX}
                </span>
              )}
            </div>
            {leads.length > 0 && (
              <div className={`text-[10.5px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                {leads.length === 1 ? "Lead" : "Leads"}: {leads.map((m) => nameOf(m)).join(", ")}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const CardView = () => {
    const groups = orgTeams.map((d) => ({
      dept: d,
      members: teamMembers.filter((m) => deptsOf(m.user_id).some((t) => String(t.id) === String(d.id))),
    }));
    const noDept = teamMembers.filter((m) => deptsOf(m.user_id).length === 0);
    return (
      <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(({ dept, members }) => <TeamCard key={dept.id} dept={dept} members={members} />)}
        {noDept.length > 0 && <TeamCard dept={null} members={noDept} />}
      </div>
    );
  };

  const ListView = () => {
    const rows = [...teamMembers].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const th = `text-left text-[10px] font-semibold uppercase tracking-wider pb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`;
    const td = `py-1.5 align-middle text-[12px] ${dark ? "text-slate-300" : "text-slate-600"}`;
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="w-full border-collapse">
          <thead>
            <tr className={`border-b ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
              <th className={`${th} pl-1`}>Name</th>
              <th className={th}>Department</th>
              <th className={th}>Manager</th>
              <th className={`${th} pr-1`}>Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const mgr = m.manager_id ? byId.get(m.manager_id) : null;
              const depts = deptsOf(m.user_id).map((t) => t.name).join(", ");
              const roleLabel = m.is_owner ? "Owner" : m.role === "admin" ? "Admin" : isLeadAnywhere(m.user_id) ? "Lead" : "Member";
              return (
                <tr
                  key={m.user_id}
                  onClick={(e) => open(m.user_id, e)}
                  className={`cursor-pointer border-b last:border-0 ${dark ? "border-[var(--color-border-light)] hover:bg-white/5" : "border-slate-100 hover:bg-slate-50"}`}
                >
                  <td className={`${td} pl-1`}>
                    <span className="flex items-center gap-2 min-w-0">
                      <UserAvatar url={avatarOf(m)} name={nameOf(m)} size={22} />
                      <span className="min-w-0">
                        <span className={`block font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>{nameOf(m)}</span>
                        {titleOf(m) && <span className="block text-[10.5px] opacity-60 truncate">{titleOf(m)}</span>}
                      </span>
                    </span>
                  </td>
                  <td className={td}>{depts || <span className="opacity-40">—</span>}</td>
                  <td className={td}>{mgr ? nameOf(mgr) : <span className="opacity-40">—</span>}</td>
                  <td className={`${td} pr-1`}>
                    <span className="inline-flex items-center gap-1"><RoleBadge m={m} /> {roleLabel}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const TreeView = () => {
    // Build children map from manager_id. Roots = no manager (or manager not in
    // this org). Closed cycles are promoted to a root so they still render.
    const childrenOf = new Map();
    const roots = [];
    const managerOf = (m) => (m.manager_id && byId.has(m.manager_id) && m.manager_id !== m.user_id ? byId.get(m.manager_id) : null);
    for (const m of teamMembers) {
      const mgr = managerOf(m);
      if (!mgr) roots.push(m);
      else { if (!childrenOf.has(mgr.user_id)) childrenOf.set(mgr.user_id, []); childrenOf.get(mgr.user_id).push(m); }
    }

    const markReachable = (m, seen) => {
      if (seen.has(m.user_id)) return;
      seen.add(m.user_id);
      for (const child of childrenOf.get(m.user_id) || []) markReachable(child, seen);
    };
    const reachable = new Set();
    for (const root of roots) markReachable(root, reachable);
    for (const m of teamMembers) {
      if (reachable.has(m.user_id)) continue;

      const chain = new Set();
      let cur = m;
      while (cur && !chain.has(cur.user_id) && !reachable.has(cur.user_id)) {
        chain.add(cur.user_id);
        cur = managerOf(cur);
      }

      const fallbackRoot = cur && chain.has(cur.user_id) && !reachable.has(cur.user_id) ? cur : m;
      roots.push(fallbackRoot);
      markReachable(fallbackRoot, reachable);
    }
    // Owner floats to the top of the roots.
    roots.sort((a, b) => (b.is_owner ? 1 : 0) - (a.is_owner ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)));

    const Node = ({ m, depth, seen }) => {
      if (seen.has(m.user_id)) return null; // cycle guard
      const kids = childrenOf.get(m.user_id) || [];
      const nextSeen = new Set(seen); nextSeen.add(m.user_id);
      return (
        <div>
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
            {depth > 0 && <ChevronRight className={`w-3 h-3 shrink-0 ${dark ? "text-slate-600" : "text-slate-300"}`} />}
            <div className="flex-1 min-w-0"><MemberRow m={m} compact /></div>
          </div>
          {kids.length > 0 && (
            <div className={`ml-2 border-l ${dark ? "border-[var(--color-border-light)]" : "border-slate-100"}`}>
              {kids.map((k) => <Node key={k.user_id} m={k} depth={depth + 1} seen={nextSeen} />)}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-0.5">
        {roots.map((m) => <Node key={m.user_id} m={m} depth={0} seen={new Set()} />)}
        {roots.length === teamMembers.length && (
          <p className={`text-[11px] mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            No reporting lines set yet. Admins can set a member's manager from the People list.
          </p>
        )}
      </div>
    );
  };

  const viewMeta = { card: { Icon: LayoutGrid, label: "Cards" }, list: { Icon: ListIcon, label: "List" }, tree: { Icon: GitBranch, label: "Reporting" } };

  return (
    <div className="rounded-2xl border p-4" style={{ background: surface, borderColor: border }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
          <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Org chart</span>
          <span className={`text-[11px] shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`}>{teamMembers.length} {teamMembers.length === 1 ? "person" : "people"}</span>
        </div>
        {/* View toggle */}
        <div className={`inline-flex rounded-lg p-0.5 shrink-0 ${dark ? "bg-white/5" : "bg-slate-100"}`}>
          {VIEWS.map((v) => {
            const { Icon, label } = viewMeta[v];
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                title={label}
                aria-pressed={active}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  active
                    ? dark ? "bg-[var(--color-surface-raised)] text-slate-100 shadow-sm" : "bg-white text-slate-800 shadow-sm"
                    : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-3">
        <Building2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        <span className={`text-[13px] font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>{activeTeam.name}</span>
      </div>

      {/* Leadership band — always shown so who's who is obvious at a glance. */}
      {(owner || admins.length > 0 || leads.length > 0) && (
        <div className={`mb-3 rounded-xl border p-2 ${dark ? "border-[var(--color-border)] bg-white/[0.02]" : "border-slate-200 bg-slate-50/60"}`}>
          <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>Leadership</div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {owner && <div className="min-w-[160px]"><MemberRow m={owner} compact /></div>}
            {admins.map((m) => <div key={m.user_id} className="min-w-[160px]"><MemberRow m={m} compact /></div>)}
            {leads.map((m) => <div key={m.user_id} className="min-w-[160px]"><MemberRow m={m} compact /></div>)}
          </div>
        </div>
      )}

      {view === "card" && <CardView />}
      {view === "list" && <ListView />}
      {view === "tree" && <TreeView />}
    </div>
  );
}
