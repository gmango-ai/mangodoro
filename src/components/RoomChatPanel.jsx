import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Pencil, Trash2, Check, X, Clock } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useProfileCard } from "../context/ProfileContext";
import { useRoomChat } from "../lib/useRoomChat";
import { emitMention } from "../lib/notifications";
import { getProfiles } from "../lib/profiles";
import { availability, isOutOfOffice } from "../lib/timezone";
import UserAvatar from "./UserAvatar";

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
    + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Renders a single message bubble. We group adjacent messages from
// the same author (no repeated header) to keep the list tight, which
// the parent decides via the `compact` flag.
//
// Own messages get hover-revealed edit + delete affordances. The
// parent owns the edit state so only one message is editable at a
// time and Escape / Enter shortcuts are uniform.
function MessageRow({
  message, compact, dark, isOwn, isEditing, renderBody, openProfile,
  editDraft, onEditDraftChange, onStartEdit, onCancelEdit, onSaveEdit, onDelete,
}) {
  const editAreaRef = useRef(null);

  useEffect(() => {
    if (isEditing && editAreaRef.current) {
      editAreaRef.current.focus();
      // Cursor at end.
      const len = editAreaRef.current.value.length;
      editAreaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const onEditKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancelEdit();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSaveEdit();
    }
  };

  return (
    <div className={`group relative flex gap-2 ${compact ? "" : "mt-3"}`}>
      <div className="w-7 shrink-0">
        {!compact && (
          <button type="button" className="rounded-full" onClick={(e) => openProfile?.(message.user_id, e.currentTarget.getBoundingClientRect())} title="View profile">
            <UserAvatar
              url={message.author?.avatar_url || ""}
              name={message.author?.name || "Member"}
              size={28}
            />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <button
              type="button"
              onClick={(e) => openProfile?.(message.user_id, e.currentTarget.getBoundingClientRect())}
              className={`text-xs font-semibold hover:underline ${dark ? "text-slate-200" : "text-slate-700"}`}
            >
              {message.author?.name || "Member"}
            </button>
            <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {formatTime(message.created_at)}
              {message.edited_at && " · edited"}
            </span>
          </div>
        )}
        {isEditing ? (
          <div className="flex flex-col gap-1">
            <textarea
              ref={editAreaRef}
              value={editDraft}
              onChange={(e) => onEditDraftChange(e.target.value)}
              onKeyDown={onEditKeyDown}
              rows={Math.min(6, Math.max(1, (editDraft.match(/\n/g) || []).length + 1))}
              className={`w-full resize-none rounded-md border px-2 py-1.5 text-sm ${
                dark
                  ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100"
                  : "bg-white border-slate-300 text-slate-800"
              }`}
            />
            <div className="flex items-center gap-2 text-[10px]">
              <button
                type="button"
                onClick={onSaveEdit}
                disabled={!editDraft.trim()}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-accent)] text-white disabled:opacity-40"
              >
                <Check className="w-3 h-3" /> Save
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${
                  dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <X className="w-3 h-3" /> Cancel
              </button>
              <span className={dark ? "text-slate-500" : "text-slate-400"}>
                Enter to save · Esc to cancel
              </span>
            </div>
          </div>
        ) : (
          <p className={`text-sm whitespace-pre-wrap break-words ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {renderBody ? renderBody(message) : message.body}
          </p>
        )}
      </div>

      {/* Hover actions for own messages — absolute so they sit above
          the bubble without reflowing the row. */}
      {isOwn && !isEditing && (
        <div
          className={`absolute -top-2 right-1 hidden group-hover:flex items-center gap-0.5 rounded-md border shadow-sm ${
            dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
          }`}
        >
          <button
            type="button"
            onClick={onStartEdit}
            title="Edit"
            className={`p-1 ${dark ? "text-slate-400 hover:text-slate-100" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            className={`p-1 ${dark ? "text-slate-400 hover:text-red-400" : "text-slate-500 hover:text-red-600"}`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function RoomChatPanel({ roomId, userId, fillHeight = false }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { messages, loading, send, edit, remove } = useRoomChat(roomId, userId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const scrollerRef = useRef(null);

  // @mentions: an autocomplete over teammates; selected user_ids accumulate in
  // mentionedRef and fire a `mention` notification on send.
  const { settings } = useApp();
  const { teamMembers } = useTeam();
  const { openProfile } = useProfileCard();
  const taRef = useRef(null);

  // Render a message body with @mentions linkified to the person's profile.
  // Match by teammate NAME present in the text (robust to freehand @names and
  // old messages); the stored mentioned_user_ids is just for notification
  // fan-out. Self is included so being @-mentioned links to your own profile.
  const renderBody = (message) => {
    const body = message.body || "";
    if (!body.includes("@")) return body;
    const byName = new Map(); // "@Name" → user_id (longest names matched first)
    for (const m of teamMembers || []) {
      if (m.name && m.user_id && body.includes(`@${m.name}`)) byName.set(m.name, m.user_id);
    }
    if (settings?.name && userId && body.includes(`@${settings.name}`)) byName.set(settings.name, userId);
    if (!byName.size) return body;
    const names = [...byName.keys()].sort((a, b) => b.length - a.length);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`@(${names.map(esc).join("|")})`, "g");
    const out = [];
    let last = 0, m, k = 0;
    while ((m = re.exec(body))) {
      if (m.index > last) out.push(body.slice(last, m.index));
      const id = byName.get(m[1]);
      out.push(
        <button
          key={`m${k++}`}
          type="button"
          onClick={(e) => { e.stopPropagation(); openProfile(id, e.currentTarget.getBoundingClientRect()); }}
          className="font-semibold text-[var(--color-accent)] hover:underline"
        >@{m[1]}</button>
      );
      last = m.index + m[0].length;
    }
    if (last < body.length) out.push(body.slice(last));
    return out;
  };
  const mentionedRef = useRef(new Set());
  const [mention, setMention] = useState(null); // { query, index, anchor } | null
  const myName = settings?.name || "Someone";

  // Heads-up when you're @mentioning someone who's out of office or (if they've
  // left the warning on) outside their working hours — they may not see it now.
  const mentionedInDraft = useMemo(() => {
    const ids = new Set();
    const body = draft || "";
    if (!body.includes("@")) return ids;
    for (const m of teamMembers || []) {
      if (m.user_id !== userId && m.name && body.includes(`@${m.name}`)) ids.add(m.user_id);
    }
    return ids;
  }, [draft, teamMembers, userId]);
  const [availMap, setAvailMap] = useState({});
  const fetchedRef = useRef(new Set());
  useEffect(() => {
    const need = [...mentionedInDraft].filter((id) => !fetchedRef.current.has(id));
    if (!need.length) return;
    need.forEach((id) => fetchedRef.current.add(id));
    getProfiles(need).then((map) => setAvailMap((prev) => ({ ...prev, ...map })));
  }, [mentionedInDraft]);
  const mentionWarnings = useMemo(() => {
    const out = [];
    for (const id of mentionedInDraft) {
      const p = availMap[id];
      if (!p) continue;
      const nm = (teamMembers || []).find((m) => m.user_id === id)?.name || p.display_name || "They";
      if (isOutOfOffice(p.ooo_start, p.ooo_end)) {
        const until = p.ooo_end ? ` until ${new Date(`${p.ooo_end}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}` : "";
        out.push(`${nm} is out of office${until}`);
      } else if (p.off_hours_warn !== false) {
        const a = availability(p.timezone, p.work_start, p.work_end);
        if (a.badge === "off hours") out.push(`it's after hours for ${nm}${a.label ? ` (${a.label} their time)` : ""}`);
      }
    }
    return out;
  }, [mentionedInDraft, availMap, teamMembers]);

  const candidates = mention
    ? (teamMembers || [])
        .filter((m) => m.user_id !== userId && (m.name || "").toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 6)
    : [];

  // Detect an @token immediately before the caret as the user types.
  const onDraftChange = (e) => {
    const val = e.target.value;
    setDraft(val);
    const caret = e.target.selectionStart ?? val.length;
    const m = val.slice(0, caret).match(/(^|\s)@(\w*)$/);
    if (m) setMention({ query: m[2], index: 0, anchor: caret - m[2].length - 1 });
    else setMention(null);
  };

  const insertMention = (member) => {
    if (!member) return;
    const el = taRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const start = mention?.anchor ?? caret;
    const next = `${draft.slice(0, start)}@${member.name} ${draft.slice(caret)}`;
    mentionedRef.current.add(member.user_id);
    setDraft(next);
    setMention(null);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + (member.name?.length || 0) + 2;
      el.focus();
      try { el.setSelectionRange(pos, pos); } catch { /* */ }
    });
  };

  // Auto-scroll to the bottom whenever the message list grows. We
  // don't try to be clever about "user has scrolled up to read
  // history" yet — this is the MVP behavior.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    setMention(null);
    const mentioned = [...mentionedRef.current];
    mentionedRef.current = new Set();
    const { error } = await send(body, mentioned);
    setSending(false);
    if (error) {
      setDraft(body);
      mentionedRef.current = new Set(mentioned);
      console.warn("send chat:", error.message);
      return;
    }
    // Fire a mention ping per tagged teammate (type/actor forced server-side).
    for (const rid of mentioned) {
      emitMention({
        recipient: rid,
        title: `${myName} mentioned you`, body: body.slice(0, 140),
        payload: { room_id: roomId, route: `/office/r/${roomId}` },
        entityType: "room", entityId: roomId,
      });
    }
  };

  const onKeyDown = (e) => {
    if (mention && candidates.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMention((s) => ({ ...s, index: Math.min((s.index ?? 0) + 1, candidates.length - 1) })); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMention((s) => ({ ...s, index: Math.max((s.index ?? 0) - 1, 0) })); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(candidates[mention.index ?? 0]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditDraft(m.body);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };
  const saveEdit = async () => {
    const next = editDraft.trim();
    if (!next || !editingId) return;
    const id = editingId;
    setEditingId(null);
    setEditDraft("");
    const { error } = await edit(id, next);
    if (error) console.warn("edit chat:", error.message);
  };

  const handleDelete = async (m) => {
    const ok = window.confirm("Delete this message?");
    if (!ok) return;
    const { error } = await remove(m.id);
    if (error) console.warn("delete chat:", error.message);
  };

  return (
    <div className={`flex flex-col min-h-0 ${fillHeight ? "h-full" : "h-80"}`}>
      <div
        ref={scrollerRef}
        className={`flex-1 overflow-y-auto rounded-lg border p-3 ${
          dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)]" : "bg-slate-50 border-slate-200"
        }`}
      >
        {loading ? (
          <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>Loading…</p>
        ) : messages.length === 0 ? (
          <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
            No messages yet. Say hi to your team.
          </p>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const compact = !!(
              prev
              && prev.user_id === m.user_id
              && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000
            );
            return (
              <MessageRow
                key={m.id}
                message={m}
                compact={compact}
                dark={dark}
                renderBody={renderBody}
                openProfile={openProfile}
                isOwn={m.user_id === userId}
                isEditing={editingId === m.id}
                editDraft={editDraft}
                onEditDraftChange={setEditDraft}
                onStartEdit={() => startEdit(m)}
                onCancelEdit={cancelEdit}
                onSaveEdit={saveEdit}
                onDelete={() => handleDelete(m)}
              />
            );
          })
        )}
      </div>
      {mentionWarnings.length > 0 && (
        <div className={`mt-2 flex items-start gap-1.5 text-[11px] rounded-lg px-2.5 py-1.5 ${dark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-700"}`}>
          <Clock className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{mentionWarnings.join(" · ")} — they may not see this right away.</span>
        </div>
      )}
      <div className="mt-2 flex gap-2 relative">
        {mention && candidates.length > 0 && (
          <div
            className="absolute bottom-full mb-1 left-0 w-60 rounded-xl border shadow-xl overflow-hidden z-30"
            style={{ background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
          >
            {candidates.map((m, i) => (
              <button
                key={m.user_id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm ${i === (mention.index ?? 0) ? (dark ? "bg-white/10" : "bg-slate-100") : ""} ${dark ? "text-slate-200" : "text-slate-700"}`}
              >
                <UserAvatar url={m.avatar_url} name={m.name} size={20} />
                <span className="truncate">{m.name || "Member"}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={draft}
          onChange={onDraftChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message this room…  (@ to mention)"
          className={`flex-1 resize-none rounded-lg border px-3 py-2 text-sm ${
            dark
              ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
              : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
          }`}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
