import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Target, Plus, Pencil, Trash2, Check, X, Sparkles,
  Heart, ThumbsUp, AlertTriangle, ArrowRight as ArrowRightIcon,
} from "lucide-react";
import UserAvatar from "../components/UserAvatar";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import {
  RETRO_LANES,
  getOrCreateCurrentRetro,
  listRetroCards,
  createRetroCard,
  updateRetroCard,
  deleteRetroCard,
  setRetroGoal,
  formatRetroWeek,
} from "../lib/retro";

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

export default function RetroPage() {
  const { session } = useApp();
  const { activeTeam, activeTeamId, isAdmin, teamMembers } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [retro, setRetro] = useState(null);
  const [cards, setCards] = useState([]);
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

  // Bootstrap: get or create this week's retro for the active team,
  // then load its cards. Re-runs when the active team changes.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeTeamId) return;
      setLoading(true); setError("");
      const { data, error: err } = await getOrCreateCurrentRetro(activeTeamId);
      if (cancelled) return;
      if (err) { setError(err.message || "Could not load retro."); setLoading(false); return; }
      setRetro(data);
      const { data: c } = await listRetroCards(data.id);
      if (cancelled) return;
      setCards(c || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [activeTeamId]);

  // Reset transient editor state when the retro id changes (e.g. team switch).
  useEffect(() => {
    setGoalEditing(false);
    setGoalDraft(retro?.goal || "");
    setEditingCardId(null);
    setNewCardDrafts(Object.fromEntries(RETRO_LANES.map((l) => [l.key, ""])));
  }, [retro?.id]);

  // Autofocus the card editor when one opens.
  useEffect(() => {
    if (editingCardId && editingTextareaRef.current) {
      editingTextareaRef.current.focus();
      editingTextareaRef.current.select();
    }
  }, [editingCardId]);

  const memberByUserId = useMemo(() => {
    const m = new Map();
    for (const row of teamMembers) m.set(row.user_id, row);
    return m;
  }, [teamMembers]);

  const cardsByLane = useMemo(() => {
    const m = new Map(RETRO_LANES.map((l) => [l.key, []]));
    for (const c of cards) {
      if (m.has(c.lane)) m.get(c.lane).push(c);
    }
    return m;
  }, [cards]);

  async function refreshCards() {
    if (!retro) return;
    const { data } = await listRetroCards(retro.id);
    setCards(data || []);
  }

  async function handleAddCard(laneKey) {
    if (!retro || !session?.user?.id) return;
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

  const cardCls = `rounded-2xl border p-4 ${
    dark ? "bg-slate-900/60 border-slate-700/50" : "bg-white border-slate-200 shadow-sm"
  }`;
  const subCls = `text-sm ${dark ? "text-slate-400" : "text-slate-500"}`;
  const headingCls = `text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`;

  if (!activeTeam) {
    return (
      <main className="px-4 pt-6 pb-24 max-w-[1080px] mx-auto">
        <p className={subCls}>Join or create a team first to run a retro.</p>
        <Link to="/team" className={`inline-flex items-center gap-1 mt-3 text-sm ${dark ? "text-cyan-400" : "text-teal-600"}`}>
          <ArrowLeft className="w-4 h-4" /> Back to teams
        </Link>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="px-4 pt-6 pb-24 max-w-[1080px] mx-auto space-y-4" aria-busy="true" aria-label="Loading retro">
        <Skeleton className="h-7 w-48" />
        <SkeletonCard className="h-20" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} className="h-64" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="px-4 pt-6 pb-24 max-w-[1080px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            to="/team"
            className={`inline-flex items-center gap-1 text-xs mb-1 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
          >
            <ArrowLeft className="w-3 h-3" /> {activeTeam.name}
          </Link>
          <h1 className={headingCls}>Team retro · {formatRetroWeek(retro?.week_start)}</h1>
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
              This week's goal
            </p>
            {goalEditing ? (
              <div className="mt-1.5 space-y-2">
                <textarea
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value.slice(0, 140))}
                  rows={2}
                  maxLength={140}
                  placeholder="e.g. Ship the rooms-redesign to 100% of the team"
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
                    No goal set for this week yet.
                  </p>
                )}
                {isAdmin && (
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
              {/* Lane header */}
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

              {/* Card list */}
              <ul className="space-y-2 flex-1 overflow-y-auto -mx-1 px-1">
                {laneCards.length === 0 && (
                  <li className={`text-xs italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    Nothing here yet.
                  </li>
                )}
                {laneCards.map((card) => {
                  const author = memberByUserId.get(card.author_id);
                  const isOwn = card.author_id === session?.user?.id;
                  const editing = editingCardId === card.id;
                  return (
                    <li
                      key={card.id}
                      className={`group rounded-lg border px-2.5 py-2 ${
                        dark ? "bg-slate-800/40 border-slate-700/40" : "bg-slate-50 border-slate-200/70"
                      }`}
                    >
                      {editing ? (
                        <div className="space-y-2">
                          <textarea
                            ref={editingTextareaRef}
                            value={editingBody}
                            onChange={(e) => setEditingBody(e.target.value.slice(0, 500))}
                            rows={3}
                            className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                              dark ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-slate-200 text-slate-800"
                            }`}
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
                          <p className={`text-sm whitespace-pre-wrap break-words ${dark ? "text-slate-100" : "text-slate-800"}`}>
                            {card.body}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <UserAvatar
                              url={author?.avatar_url || ""}
                              name={author?.name || "?"}
                              size={16}
                              className="shrink-0"
                            />
                            <span className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                              {author?.name || "Team member"}
                            </span>
                            {(isOwn || isAdmin) && (
                              <div className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {isOwn && (
                                  <button
                                    type="button"
                                    onClick={() => startEditCard(card)}
                                    className={`p-1 rounded ${
                                      dark ? "text-slate-400 hover:bg-slate-700/60" : "text-slate-500 hover:bg-slate-200"
                                    }`}
                                    title="Edit"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCard(card)}
                                  className={`p-1 rounded ${
                                    dark ? "text-slate-400 hover:text-red-300 hover:bg-red-500/15" : "text-slate-500 hover:text-red-600 hover:bg-red-50"
                                  }`}
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

              {/* Add-card form */}
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
            </div>
          );
        })}
      </div>
    </main>
  );
}
