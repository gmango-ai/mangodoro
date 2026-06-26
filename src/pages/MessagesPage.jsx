import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Plus, ArrowLeft, Users, MessageSquare } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useMessages } from "../context/MessagesContext";
import { useTheme } from "../context/ThemeContext";
import UserAvatar from "../components/UserAvatar";
import { listMessages, sendMessage } from "../lib/messages";

function timeShort(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Open conversation ──
function Thread({ conversation, name, memberById, userId, onBack, markRead, subscribeMessages, dark }) {
  const convId = conversation?.id;
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!convId) return;
    listMessages(convId).then(setMessages);
    markRead(convId);
  }, [convId, markRead]);

  useEffect(() => subscribeMessages((m) => {
    if (m.conversation_id !== convId) return;
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    markRead(convId);
  }), [convId, subscribeMessages, markRead]);

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !convId) return;
    setDraft("");
    const { message } = await sendMessage(convId, body, userId);
    if (message) setMessages((prev) => (prev.some((x) => x.id === message.id) ? prev : [...prev, message]));
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <button type="button" onClick={onBack} className={`p-1.5 rounded-lg ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`} aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        {conversation?.is_group ? <Users className="w-4 h-4 text-[var(--color-accent)]" /> : null}
        <span className={`text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>{name}</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 && (
          <div className={`text-center text-sm py-10 ${dark ? "text-slate-500" : "text-slate-400"}`}>No messages yet — say hi.</div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          const author = memberById.get(m.sender_id);
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
              {!mine && <UserAvatar url={author?.avatar_url || ""} name={author?.name || "Member"} size={26} />}
              <div className={`max-w-[78%] rounded-2xl px-3 py-1.5 text-sm ${
                mine ? "bg-[var(--color-accent)] text-white"
                : dark ? "bg-[var(--color-surface-raised)] text-slate-100" : "bg-slate-100 text-slate-800"
              }`}>
                {!mine && conversation?.is_group && <div className="text-[11px] font-semibold opacity-70 mb-0.5">{author?.name || "Member"}</div>}
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className={`text-[10px] mt-0.5 ${mine ? "text-white/70" : dark ? "text-slate-500" : "text-slate-400"}`}>{timeShort(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`flex items-end gap-2 p-2.5 border-t shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Message…"
          className={`flex-1 resize-none rounded-xl border px-3 py-2 text-sm max-h-32 ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"}`}
        />
        <button type="button" onClick={send} disabled={!draft.trim()} aria-label="Send" className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--color-accent)] text-white disabled:opacity-40">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── New message (pick teammates → DM or group) ──
function NewMessage({ others, onCancel, onStartDm, onCreateGroup, dark }) {
  const [picked, setPicked] = useState([]);
  const [title, setTitle] = useState("");
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const go = async () => {
    if (picked.length === 0) return;
    if (picked.length === 1) await onStartDm(picked[0]);
    else await onCreateGroup(title, picked);
  };
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center justify-between px-3 py-2.5 border-b shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <button type="button" onClick={onCancel} className={`p-1.5 rounded-lg ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`} aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
        <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>New message</span>
        <button type="button" onClick={go} disabled={picked.length === 0} className="text-sm font-semibold text-[var(--color-accent)] disabled:opacity-40">
          {picked.length > 1 ? "Create" : "Start"}
        </button>
      </div>
      {picked.length > 1 && (
        <div className="px-3 pt-2.5 shrink-0">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Group name (optional)" className={`w-full rounded-lg border px-3 py-2 text-sm ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"}`} />
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {others.length === 0 && <div className={`text-center text-sm py-10 ${dark ? "text-slate-500" : "text-slate-400"}`}>No teammates to message yet.</div>}
        {others.map((m) => {
          const on = picked.includes(m.user_id);
          return (
            <button key={m.user_id} type="button" onClick={() => toggle(m.user_id)} className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors ${on ? "bg-[var(--color-accent-light)]" : dark ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
              <UserAvatar url={m.avatar_url || ""} name={m.name || "Member"} size={32} />
              <span className={`flex-1 text-sm font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>{m.name || "Member"}</span>
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${on ? "bg-[var(--color-accent)] border-[var(--color-accent)]" : dark ? "border-slate-600" : "border-slate-300"}`}>
                {on && <span className="w-2 h-2 rounded-full bg-white" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Conversation list ──
function List({ conversations, nameOf, memberById, onOpen, onNew, dark }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center justify-between px-3 py-2.5 border-b shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <span className={`text-base font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Messages</span>
        <button type="button" onClick={onNew} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full bg-[var(--color-accent)] text-white text-[12px] font-semibold">
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {conversations.length === 0 && (
          <div className={`flex flex-col items-center justify-center gap-2 py-16 text-center ${dark ? "text-slate-500" : "text-slate-400"}`}>
            <MessageSquare className="w-7 h-7 opacity-60" />
            <p className="text-sm">No conversations yet.</p>
            <button type="button" onClick={onNew} className="text-[var(--color-accent)] text-sm font-semibold">Start one</button>
          </div>
        )}
        {conversations.map((c) => {
          const first = memberById.get(c.participant_ids[0]);
          return (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-b last:border-b-0 transition-colors ${dark ? "hover:bg-white/5 border-[var(--color-border)]" : "hover:bg-slate-50 border-slate-100"}`}>
              {c.is_group ? (
                <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-200 text-slate-600"}`}><Users className="w-4 h-4" /></span>
              ) : (
                <UserAvatar url={first?.avatar_url || ""} name={first?.name || "Member"} size={36} />
              )}
              <span className="flex-1 min-w-0">
                <span className={`block text-sm font-semibold truncate ${dark ? "text-slate-200" : "text-slate-800"}`}>{nameOf(c)}</span>
                <span className={`block text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{timeShort(c.last_message_at)}</span>
              </span>
              {c.unread && <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { session } = useApp();
  const userId = session?.user?.id;
  const { teamMembers = [] } = useTeam();
  const { conversations, startDm, createGroup, markRead, subscribeMessages } = useMessages();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c") || null;
  const [composing, setComposing] = useState(false);

  const memberById = useMemo(() => new Map(teamMembers.map((m) => [m.user_id, m])), [teamMembers]);
  const others = useMemo(() => teamMembers.filter((m) => m.user_id !== userId), [teamMembers, userId]);

  const nameOf = (c) => {
    if (!c) return "Conversation";
    if (c.is_group) return c.title || (c.participant_ids.map((id) => memberById.get(id)?.name || "Member").join(", ") || "Group");
    return memberById.get(c.participant_ids[0])?.name || "Member";
  };

  const open = (id) => setParams(id ? { c: id } : {}, { replace: true });
  const active = conversations.find((c) => c.id === activeId) || (activeId ? { id: activeId, is_group: false, participant_ids: [] } : null);

  return (
    <div className={`mx-auto w-full max-w-2xl h-[calc(100dvh-3.5rem)] flex flex-col rounded-none sm:rounded-xl sm:my-3 sm:h-[calc(100dvh-5rem)] overflow-hidden sm:border ${dark ? "bg-[var(--color-surface)] sm:border-[var(--color-border)]" : "bg-white sm:border-slate-200"}`}>
      {activeId ? (
        <Thread conversation={active} name={nameOf(active)} memberById={memberById} userId={userId} onBack={() => open(null)} markRead={markRead} subscribeMessages={subscribeMessages} dark={dark} />
      ) : composing ? (
        <NewMessage
          others={others}
          onCancel={() => setComposing(false)}
          onStartDm={async (id) => { const cid = await startDm(id); setComposing(false); if (cid) open(cid); }}
          onCreateGroup={async (title, ids) => { const cid = await createGroup(title, ids); setComposing(false); if (cid) open(cid); }}
          dark={dark}
        />
      ) : (
        <List conversations={conversations} nameOf={nameOf} memberById={memberById} onOpen={open} onNew={() => setComposing(true)} dark={dark} />
      )}
    </div>
  );
}
