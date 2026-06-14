import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Target, Plus, Pencil, Trash2, Check, X, Sparkles,
  Heart, AlertTriangle, ArrowRight as ArrowRightIcon, Link as LinkIcon, Lock, Unlock,
} from "lucide-react";
import UserAvatar from "../components/UserAvatar";
import MarkdownText from "../components/MarkdownText";
import MarkdownEditor from "../components/MarkdownEditor";
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
  setRetroLive,
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
  next_week: { dark: "text-[var(--color-accent)] bg-[var(--color-accent-light)]", light: "text-[var(--color-accent)] bg-[var(--color-accent-light)]" },
};

const STICKY_COLORS = [
  { hex: "#fde68a", label: "Yellow" },
  { hex: "#fbcfe8", label: "Pink" },
  { hex: "#bfdbfe", label: "Blue" },
  { hex: "#bbf7d0", label: "Green" },
  { hex: "#ddd6fe", label: "Purple" },
  { hex: "#fed7aa", label: "Orange" },
  { hex: "#fecaca", label: "Coral" },
  { hex: "#e2e8f0", label: "Slate" },
];

export default function RetroPage() {
  const { retroId } = useParams();
  const { session, stickyColor: myStickyColor, setStickyColor } = useApp();
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


  // Invite copy feedback.
  const [inviteCopied, setInviteCopied] = useState(false);

  // Stash latest switchTeam + teams in refs so the load effect can use
  // them without depending on them. Previously the effect re-ran every
  // time teams' identity changed in TeamContext (which is often), which
  // re-fetched the retro and stomped the goal textarea — every retro
  // re-render reset the textarea state and the cursor jumped to the top.
  const switchTeamRef = useRef(switchTeam);
  const teamsRef = useRef(teams);
  useEffect(() => { switchTeamRef.current = switchTeam; }, [switchTeam]);
  useEffect(() => { teamsRef.current = teams; }, [teams]);

  // Load the retro + its cards + participant list. Only re-runs on
  // retroId change — see refs above for why.
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
      const teamsNow = teamsRef.current;
      if (teamsNow?.length && data.team_id && teamsNow.some((t) => t.id === data.team_id)) {
        switchTeamRef.current?.(data.team_id);
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
  }, [retroId]);

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

  // Live/closed is now the source of truth for editability. is_live
  // defaults to true on new retros; admins can flip via the header
  // toggle. Past retros were back-filled to is_live=false.
  const readOnly = !retro?.is_live;
  const [liveToggling, setLiveToggling] = useState(false);

  async function handleToggleLive() {
    if (!retro) return;
    setLiveToggling(true); setError("");
    const next = !retro.is_live;
    const { error: err } = await setRetroLive(retro.id, next);
    setLiveToggling(false);
    if (err) { setError(err.message || "Could not change retro state."); return; }
    setRetro({ ...retro, is_live: next });
  }

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

  // Sticky-color update is optimistic: flip AppContext state immediately
  // so own cards re-render the same tick, then persist to user_settings.
  // Without setStickyColor exposed (the bug behind "change doesn't take
  // until refresh"), the local state was stuck on the loadData value.
  async function chooseStickyColor(hex) {
    if (!session?.user?.id) return;
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    if (hex.toLowerCase() === (myStickyColor || "").toLowerCase()) return;
    setStickyColor(hex);
    const { error: err } = await supabase
      .from("user_settings")
      .upsert({ user_id: session.user.id, sticky_color: hex }, { onConflict: "user_id" });
    if (err) {
      // Revert the optimistic update if the save fails so we don't lie
      // to the user about persistence.
      setStickyColor(myStickyColor);
      setError(err.message || "Couldn't save your color.");
    }
  }

  async function copyInviteLink() {
    if (!retro?.invite_code) return;
    const url = `${window.location.origin}/retros/join/${retro.invite_code}`;
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  const cardCls = `rounded-2xl border p-4 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border-light)]" : "bg-white border-slate-200 shadow-sm"
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
        <Link to="/retros" className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)]">
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
            <span
              className={`ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                readOnly
                  ? dark ? "bg-[var(--color-surface-raised)] text-slate-400" : "bg-slate-100 text-slate-500"
                  : dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {readOnly
                ? <><Lock className="w-3 h-3" /> Closed</>
                : <><span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> Live</>}
            </span>
          </h1>
        </div>

        {/* Header actions — Invite + admin Close/Reopen */}
        <div className="flex items-center gap-2">
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
          {/* Admin: live/closed toggle */}
          {isAdmin && (
            <Button
              size="sm"
              variant={readOnly ? "default" : "outline"}
              onClick={handleToggleLive}
              disabled={liveToggling}
              title={readOnly ? "Reopen this retro for edits" : "Close this retro (read-only)"}
              className="h-8 text-xs"
            >
              {readOnly ? <Unlock className="w-3.5 h-3.5 mr-1" /> : <Lock className="w-3.5 h-3.5 mr-1" />}
              {liveToggling ? "…" : readOnly ? "Reopen" : "Close"}
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
          <div className="p-2 rounded-lg shrink-0 bg-[var(--color-accent-light)]">
            <Target className="w-5 h-5 text-[var(--color-accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {readOnly ? "Goal for next week" : "Next week's goal"}
            </p>
            {goalEditing && !readOnly ? (
              <div className="mt-1.5 space-y-2">
                {/* Inline markdown editor — formatting renders as you
                    type (bold reads bolder, headings get larger, etc.).
                    No separate preview pane. */}
                <MarkdownEditor
                  value={goalDraft}
                  onChange={(v) => setGoalDraft(v.slice(0, 2000))}
                  dark={dark}
                  autoFocus
                  minHeight="140px"
                  placeholder="What's the focus next week?"
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
                    Markdown supported · {2000 - goalDraft.length} chars left
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-1 flex items-start gap-3">
                {retro?.goal ? (
                  <div className={`flex-1 ${dark ? "text-slate-100" : "text-slate-800"}`}>
                    <MarkdownText dark={dark}>{retro.goal}</MarkdownText>
                  </div>
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

      {/* Inline sticky-color strip — always visible, instant feedback.
          Picking a swatch updates AppContext optimistically so own cards
          re-render the same tick. Hidden in read-only retros since no
          new cards will be authored. */}
      {!readOnly && (
        <div className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border ${
          dark ? "bg-[var(--color-bg)] border-[var(--color-border-light)]" : "bg-white border-slate-200"
        }`}>
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-400" : "text-slate-500"
          }`}>
            Your sticky color
          </span>
          <div className="flex items-center gap-1.5 ml-auto sm:ml-2">
            {STICKY_COLORS.map((c) => {
              const selected = myStickyColor?.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => chooseStickyColor(c.hex)}
                  aria-label={c.label}
                  aria-pressed={selected}
                  title={c.label}
                  className={`relative flex items-center justify-center w-7 h-7 rounded-md border border-black/10 transition-transform hover:scale-110 ${
                    selected
                      ? dark
                        ? "outline outline-2 outline-offset-2 outline-white"
                        : "outline outline-2 outline-offset-2 outline-slate-900"
                      : ""
                  }`}
                  style={{ background: c.hex }}
                >
                  {selected && <Check className="w-3.5 h-3.5 text-slate-900" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
                <div className="border-t pt-2.5 mt-auto border-[var(--color-border-light)]">
                  <textarea
                    value={newCardDrafts[lane.key]}
                    onChange={(e) =>
                      setNewCardDrafts((prev) => ({ ...prev, [lane.key]: e.target.value.slice(0, 500) }))
                    }
                    rows={2}
                    placeholder="Add to this lane…"
                    onKeyDown={(e) => {
                      // Enter submits; Cmd/Ctrl+Enter inserts a newline.
                      // Mirrors how Slack/Linear behave for short notes —
                      // most cards are a single line and the submit
                      // friction was breaking the rhythm of dropping in
                      // ideas during a retro.
                      if (e.key === "Enter" && !(e.metaKey || e.ctrlKey) && !e.shiftKey) {
                        e.preventDefault();
                        handleAddCard(lane.key);
                      }
                    }}
                    className={`w-full rounded-md border px-2 py-1.5 text-sm resize-none ${
                      dark
                        ? "bg-[var(--color-bg)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
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
