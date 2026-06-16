import { useEffect, useRef, useState } from "react";
import { Send, Pencil, Trash2, Check, X } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useRoomChat } from "../lib/useRoomChat";
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
  message, compact, dark, isOwn, isEditing,
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
          <UserAvatar
            url={message.author?.avatar_url || ""}
            name={message.author?.name || "Member"}
            size={28}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className={`text-xs font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>
              {message.author?.name || "Member"}
            </span>
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
            {message.body}
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
    const { error } = await send(body);
    setSending(false);
    if (error) {
      setDraft(body);
      console.warn("send chat:", error.message);
    }
  };

  const onKeyDown = (e) => {
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
      <div className="mt-2 flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message this room…"
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
