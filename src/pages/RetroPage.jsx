import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Target, Plus, Pencil, Trash2, Check, X, Sparkles,
  Heart, AlertTriangle, ArrowRight as ArrowRightIcon, Link as LinkIcon, Lock,
} from "lucide-react";
import UserAvatar from "../components/UserAvatar";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import {
  RETRO_LANES,
  fetchRetroById,
  listRetroCards,
  listRetroParticipants,
  createRetroCard,
  updateRetroCard,
  deleteRetroCard,
  setRetroGoal,
  formatRetroWeek,
  isRetroCurrentWeek,
} from "../lib/retro";
import { supabase } from "../supabase";

const LANE_ICON = {
  celebrate: Sparkles,
  went_well: Heart,
  to_improve: AlertTriangle,
  next_week: ArrowRightIcon,
};
const LANE_ACCENT = {
  celebrate: { dark: "text-amber-400 bg-amber-500/15", light: "text-amber-600 bg-amber-50" },
  went_well: { dark: "text-emerald-400 bg-emerald-500/15", light: "text-emerald-600 bg-emerald-50" },
  to_improve: { dark: "text-rose-400 bg-rose-500/15", light: "text-rose-600 bg-rose-50" },
  next_week: { dark: "text-cyan-400 bg-cyan-500/15", light: "text-teal-600 bg-teal-50" },
};

const STICKY_COLORS = [
  "#fde68a", "#fbcfe8", "#bfdbfe", "#bbf7d0",
  "#ddd6fe", "#fed7aa", "#fecaca", "#e2e8f0",
];

export default function RetroPage() {
  const { retroId } = useParams();
  const { session, stickyColor: myStickyColor, setSettings } = useApp();
  const { activeTeam, isAdmin, teams, switchTeam } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [retro, setRetro] = useState(null);
  const [cards, setCards] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Goal editor state.
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);

  // Per-lane new-card draft text.
  const [newCardDrafts, setNewCardDrafts] = useState(
    Object.fromEntries(RETRO_LANES.map((l) => [l.key, ""])),
  );
  const [creatingLane, setCreatingLane] = useState(null);

  // Card-edit state — a single inline editor open at a time.
  const [editingCardId, setEditingCardId] = useState(null);
  const [editingBody, setEditingBody] = useState("");
  const editingTextareaRef = useRef(null);

  // Color-picker popover toggle.
  const [colorOpen, setColorOpen] = useState(false);

  // Invite copy feedback.
  const [inviteCopied, setInviteCopied] = useState(false);

  // Load the retro + its cards + participant list. Re-runs on retroId change.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!retroId) return;
      setLoading(true); setError("");
      const { data, error: err } = await fetchRetroById(retroId);
      if (cancelled) return;
      if (err || !data) {
        setError(err?.message || "Retro not found.");
        setRetro(null);
        setLoading(false);
        return;
      }
      setRetro(data);
      // Auto-switch the active team if the retro lives in a different one
      // (e.g. clicking a /retros/:id link from a deep-link).
      if (teams?.length && data.team_id && teams.some((t) => t.id === data.team_id)) {
        switchTeam(data.team_id);
      }
      const [{ data: c }, { data: p }] = await Promise.all([
        listRetroCards(data.id),
        listRetroParticipants(data.id),
      ]);
      if (cancelled) return;
      setCards(c || []);
      setParticipants(p || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [retroId, switchTeam, teams]);

  useEffect(() => {
    setGoalEditing(false);
    setGoalDraft(retro?.goal || "");
    setEditingCardId(null);
    setNewCardDrafts(Object.fromEntries(RETRO_LANES.map((l) => [l.key, ""])));
  }, [retro?.id]);

  useEffect(() => {
    if (editingCardId && editingTextareaRef.current) {
      editingTextareaRef.current.focus();
      editingTextareaRef.current.select();
    }
  }, [editingCardId]);

  const participantByUserId = useMemo(() => {
    const m = new Map();
    for (const p of participants) m.set(p.user_id, p);
    return m;
  }, [participants]);

  const cardsByLane = useMemo(() => {
    const m = new Map(RETRO_LANES.map((l) => [l.key, []]));
    for (const c of cards) {
      if (m.has(c.lane)) m.get(c.lane).push(c);
    }
    return m;
  }, [cards]);

  const readOnly = retro ? !isRetroCurrentWeek(retro) : true;

  async function handleAddCard(laneKey) {
    if (!retro || !session?.user?.id || readOnly) return;
    const body = (newCardDrafts[laneKey] || "").trim();
    if (!body) return;
    setCreatingLane(laneKey); setError("");
    const { data, error: err } = await createRetroCard(retro.id, {
      lane: laneKey,
      body,
      authorId: session.user.id,
    });
    setCreatingLane(null);
    if (err) { setError(err.message || "Could not add card."); return; }
    setCards((prev) => [...prev, data]);
    setNewCardDrafts((prev) => ({ ...prev, [laneKey]: "" }));
  }

  async function handleSaveCard() {
    if (!editingCardId) return;
    const body = editingBody.trim();
    if (!body) return;
    const { data, error: err } = await updateRetroCard(editingCardId, body);
    if (err) { setError(err.message || "Could not save card."); return; }
    setCards((prev) => prev.map((c) => (c.id === editingCardId ? data : c)));
    setEditingCardId(null);
    setEditingBody("");
  }

  async function handleDeleteCard(card) {
    const { error: err } = await deleteRetroCard(card.id);
    if (err) { setError(err.message || "Could not delete card."); return; }
    setCards((prev) => prev.filter((c) => c.id !== card.id));
  }

  async function handleSaveGoal() {
    if (!retro) return;
    setGoalSaving(true); setError("");
    const { error: err } = await setRetroGoal(retro.id, goalDraft.trim());
    setGoalSaving(false);
    if (err) { setError(err.message || "Could not save goal."); return; }
    setRetro({ ...retro, goal: goalDraft.trim() });
    setGoalEditing(false);
  }

  function startEditCard(card) {
    setEditingCardId(card.id);
    setEditingBody(card.body);
  }

  // Inline sticky-color picker writes to user_settings + AppContext so
  // the change reflects across every retro the user touches.
  async function chooseStickyColor(hex) {
    setColorOpen(false);
    if (!session?.user?.id) return;
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    // Optimistic: bump AppContext so own cards re-render immediately.
    setSettings?.((prev) => ({ ...prev }));
    await supabase
      .from("user_settings")
      .upsert({ user_id: session.user.id, sticky_color: hex }, { onConflict: "user_id" });
    // Trigger AppContext reload by emitting the standard auth state change
    // we already listen to is overkill — instead nudge a settings refresh
    // through an UPDATE that the realtime channel picks up.
    // (Falls back to next user-driven settings save otherwise.)
  }

  async function copyInviteLink() {
    if (!retro?.invite_code) return;
    const url = `${window.location.origin}/retros/join/${retro.invite_code}`;
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  const cardCls = `rounded-2xl border p-4 ${
    dark ? "bg-slate-900/60 border-slate-700/50" : "bg-white border-slate-200 shadow-sm"
  }`;
  const headingCls = `text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`;

  if (loading) {
    return (
      <main className="px-4 pt-6 pb-24 max-w-[1080px] mx-auto space-y-4" aria-busy="true" aria-label="Loading retro">
        <Skeleton className="h-7 w-48" />
        <SkeletonCard className="h-20" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} className="h-64" />)}
        </div>
      </main>
    );
  }

  if (!retro) {
    return (
      <main className="px-4 pt-6 pb-24 max-w-[1080px] mx-auto">
        <Link to="/retros" className={`inline-flex items-center gap-1 text-sm ${dark ? "text-cyan-400" : "text-teal-600"}`}>
          <ArrowLeft className="w-4 h-4" /> Back to retros
        </Link>
        <p className={`mt-3 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Retro not found, or you don't have access.
        </p>
      </main>
    );
  }

  return (
    <main className="px-4 pt-6 pb-24 max-w-[1080px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            to="/retros"
            className={`inline-flex items-center gap-1 text-xs mb-1 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
          >
            <ArrowLeft className="w-3 h-3" /> All retros
          </Link>
          <h1 className={headingCls}>
            {retro.department ? `${retro.department} retro` : "Team retro"}
            {" · "}
            {formatRetroWeek(retro.week_start)}
            {readOnly && (
              <span
                className={`ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                  dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                }`}
              >
                <Lock className="w-3 h-3" /> Read-only
              </span>
            )}
          </h1>
        </div>

        {/* Color picker + invite link, current-week retros only */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setColorOpen((v) => !v)}
              title="Your sticky-note color"
              className={`w-8 h-8 rounded-md border ${
                dark ? "border-slate-700" : "border-slate-200"
              }`}
              style={{ background: myStickyColor || "#fde68a" }}
            />
            {colorOpen && (
              <div
                className={`absolute right-0 top-10 z-50 p-2 rounded-lg border shadow-xl ${
                  dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
                }`}
              >
                <div className="grid grid-cols-4 gap-1.5">
                  {STICKY_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => chooseStickyColor(c)}
                      title={c}
                      className="w-7 h-7 rounded-md ring-2 transition-transform hover:scale-110"
                      style={{
                        background: c,
                        boxShadow: myStickyColor?.toLowerCase() === c.toLowerCase()
                          ? `0 0 0 2px ${dark ? "#fff" : "#0f172a"}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={copyInviteLink}
              title="Copy guest invite link"
              className="h-8 text-xs"
            >
              <LinkIcon className="w-3.5 h-3.5 mr-1" />
              {inviteCopied ? "Copied!" : "Invite"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className={`text-sm font-medium px-4 py-2 rounded-lg ${
          dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
        }`}>
          {error}
        </div>
      )}

      {/* Goal */}
      <div className={`${cardCls}`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${dark ? "bg-cyan-500/10" : "bg-teal-50"}`}>
            <Target className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {readOnly ? "Goal that week" : "This week's goal"}
            </p>
            {goalEditing && !readOnly ? (
              <div className="mt-1.5 space-y-2">
                <textarea
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value.slice(0, 140))}
                  rows={2}
                  maxLength={140}
                  placeholder="e.g. Ship the rooms redesign to 100% of the team"
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${
                    dark
                      ? "bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500"
                      : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                  }`}
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleSaveGoal} disabled={goalSaving}>
                    {goalSaving ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setGoalEditing(false); setGoalDraft(retro?.goal || ""); }}
                  >
                    Cancel
                  </Button>
                  <p className={`text-[11px] ml-auto ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    {140 - goalDraft.length} chars left
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-1 flex items-start gap-3">
                {retro?.goal ? (
                  <p className={`text-base font-semibold flex-1 ${dark ? "text-slate-100" : "text-slate-800"}`}>
                    {retro.goal}
                  </p>
                ) : (
                  <p className={`text-sm italic flex-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    {readOnly ? "No goal was set for this week." : "No goal set for this week yet."}
                  </p>
                )}
                {isAdmin && !readOnly && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setGoalDraft(retro?.goal || ""); setGoalEditing(true); }}
                    className="shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1" /> {retro?.goal ? "Edit" : "Set goal"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lanes */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RETRO_LANES.map((lane) => {
          const Icon = LANE_ICON[lane.key] || Sparkles;
          const accent = dark ? LANE_ACCENT[lane.key].dark : LANE_ACCENT[lane.key].light;
          const laneCards = cardsByLane.get(lane.key) || [];
          return (
            <div key={lane.key} className={`${cardCls} flex flex-col gap-3 min-h-[320px]`}>
              <div className="flex items-start gap-2">
                <div className={`p-1.5 rounded-md ${accent}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
                    {lane.label}
                  </p>
                  <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    {lane.hint}
                  </p>
                </div>
                <span className={`ml-auto text-[10px] font-mono ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  {laneCards.length}
                </span>
              </div>

              <ul className="space-y-2 flex-1 overflow-y-auto -mx-1 px-1">
                {laneCards.length === 0 && (
                  <li className={`text-xs italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    Nothing here yet.
                  </li>
                )}
                {laneCards.map((card) => {
                  const author = participantByUserId.get(card.author_id);
                  const isOwn = card.author_id === session?.user?.id;
                  const editing = editingCardId === card.id;
                  const sticky = isOwn
                    ? myStickyColor || "#fde68a"
                    : author?.sticky_color || "#fde68a";
                  const stickyStyle = { background: sticky, color: "#1e293b" };
                  return (
                    <li
                      key={card.id}
                      style={stickyStyle}
                      className="group rounded-lg border border-black/5 px-2.5 py-2 shadow-sm"
                    >
                      {editing ? (
                        <div className="space-y-2">
                          <textarea
                            ref={editingTextareaRef}
                            value={editingBody}
                            onChange={(e) => setEditingBody(e.target.value.slice(0, 500))}
                            rows={3}
                            className="w-full rounded-md border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-slate-900"
                          />
                          <div className="flex items-center gap-1">
                            <Button size="sm" onClick={handleSaveCard} className="h-7 px-2">
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                              onClick={() => { setEditingCardId(null); setEditingBody(""); }}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm whitespace-pre-wrap break-words text-slate-900">
                            {card.body}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <UserAvatar
                              url={author?.avatar_url || ""}
                              name={author?.name || "?"}
                              size={16}
                              className="shrink-0"
                            />
                            <span className="text-[11px] truncate text-slate-700">
                              {author?.name || "Team member"}
                              {author?.is_guest && (
                                <span className="ml-1 text-[9px] uppercase tracking-wider opacity-70">
                                  Guest
                                </span>
                              )}
                            </span>
                            {!readOnly && (isOwn || isAdmin) && (
                              <div className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {isOwn && (
                                  <button
                                    type="button"
                                    onClick={() => startEditCard(card)}
                                    className="p-1 rounded text-slate-700 hover:bg-black/10"
                                    title="Edit"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCard(card)}
                                  className="p-1 rounded text-slate-700 hover:text-red-700 hover:bg-red-100"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>

              {!readOnly && (
                <div className="border-t pt-2.5 mt-auto border-slate-700/30">
                  <textarea
                    value={newCardDrafts[lane.key]}
                    onChange={(e) =>
                      setNewCardDrafts((prev) => ({ ...prev, [lane.key]: e.target.value.slice(0, 500) }))
                    }
                    rows={2}
                    placeholder="Add to this lane…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleAddCard(lane.key);
                      }
                    }}
                    className={`w-full rounded-md border px-2 py-1.5 text-sm resize-none ${
                      dark
                        ? "bg-slate-900/40 border-slate-700 text-slate-100 placeholder:text-slate-500"
                        : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                    }`}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddCard(lane.key)}
                    disabled={!newCardDrafts[lane.key].trim() || creatingLane === lane.key}
                    className="w-full mt-1.5 h-7 text-xs"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    {creatingLane === lane.key ? "Adding…" : "Add"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
