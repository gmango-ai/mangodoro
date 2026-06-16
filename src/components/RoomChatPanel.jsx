import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
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
function MessageRow({ message, compact, dark }) {
  return (
    <div className={`flex gap-2 ${compact ? "" : "mt-3"}`}>
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
        <p className={`text-sm whitespace-pre-wrap break-words ${dark ? "text-slate-100" : "text-slate-800"}`}>
          {message.body}
        </p>
      </div>
    </div>
  );
}

export default function RoomChatPanel({ roomId, userId }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { messages, loading, send } = useRoomChat(roomId, userId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
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
      // Restore draft so the user can retry.
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

  return (
    <div className="flex flex-col h-80">
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
            return <MessageRow key={m.id} message={m} compact={compact} dark={dark} />;
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
