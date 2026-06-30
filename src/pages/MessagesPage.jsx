import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import {
  Send, Plus, ArrowLeft, Users, MessageSquare, Hash, Search, Paperclip, X,
  SmilePlus, Pencil, Trash2, Pin, PinOff, Bell, BellOff, Megaphone, Settings2,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useMessages } from "../context/MessagesContext";
import { useTheme } from "../context/ThemeContext";
import UserAvatar from "../components/UserAvatar";
import { EMOTES } from "../components/emotes/presets";
import {
  listMessages, sendMessage, editMessage, deleteMessage,
  listReactions, toggleReaction, listReadMarks, setChannelMeta,
  setConversationPinned, setConversationMuted,
} from "../lib/messages";
import { attachToMessage, listAttachments, isImage } from "../lib/messageAttachments";
import { emitMention } from "../lib/notifications";
import { supabase } from "../supabase";

function timeShort(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── light markdown body (bold/italic/code/links) ──
function Body({ text }) {
  return (
    <div className="whitespace-pre-wrap break-words [&_a]:underline [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-black/10 [&_p]:m-0 [&_ul]:my-1 [&_ul]:pl-4 [&_ul]:list-disc">
      <Markdown
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {text || ""}
      </Markdown>
    </div>
  );
}

// ── reactions ──
function ReactionBar({ reactions, onToggle, dark }) {
  const entries = reactions ? [...reactions.entries()] : [];
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex items-center gap-1 flex-wrap mt-0.5">
      {entries.map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji, mine)}
          className={`inline-flex items-center gap-0.5 px-1.5 h-5 rounded-full text-[11px] border ${
            mine
              ? "bg-[var(--color-accent-light)] border-[var(--color-accent)]"
              : dark ? "bg-white/5 border-white/10" : "bg-slate-100 border-slate-200"
          }`}
        >
          <span>{emoji}</span><span className="font-semibold">{count}</span>
        </button>
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"}`}
          aria-label="Add reaction"
        >
          <SmilePlus className="w-3.5 h-3.5" />
        </button>
        {picking && (
          <div className={`absolute z-20 bottom-6 left-0 flex gap-1 p-1 rounded-lg border shadow ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"}`}>
            {EMOTES.map((e) => (
              <button key={e.key} type="button" onClick={() => { onToggle(e.glyph, reactions?.get(e.glyph)?.mine); setPicking(false); }} className="text-base hover:scale-110 transition-transform">
                {e.glyph}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── @-mention composer ──
function Composer({ onSend, candidates, dark, placeholder = "Message…" }) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const [mentionQ, setMentionQ] = useState(null); // active @query or null
  const taRef = useRef(null);
  const fileRef = useRef(null);

  const matches = useMemo(() => {
    if (mentionQ == null) return [];
    const q = mentionQ.toLowerCase();
    return candidates.filter((m) => (m.name || "").toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQ, candidates]);

  const onChange = (e) => {
    const v = e.target.value;
    setDraft(v);
    const upto = v.slice(0, e.target.selectionStart);
    const m = upto.match(/@([\w]*)$/);
    setMentionQ(m ? m[1] : null);
  };

  const pickMention = (member) => {
    const ta = taRef.current;
    const pos = ta ? ta.selectionStart : draft.length;
    const before = draft.slice(0, pos).replace(/@([\w]*)$/, `@${(member.name || "").replace(/\s+/g, "")} `);
    const after = draft.slice(pos);
    setDraft(before + after);
    setMentionQ(null);
    setTimeout(() => ta?.focus(), 0);
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body && files.length === 0) return;
    setDraft(""); setFiles([]); setMentionQ(null);
    await onSend(body, files);
  };

  return (
    <div className={`border-t shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
      {files.length > 0 && (
        <div className="flex gap-2 flex-wrap px-2.5 pt-2">
          {files.map((f, i) => (
            <span key={i} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg ${dark ? "bg-white/10 text-slate-200" : "bg-slate-100 text-slate-700"}`}>
              {f.name.slice(0, 24)}
              <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} aria-label="Remove"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative flex items-end gap-2 p-2.5">
        {matches.length > 0 && (
          <div className={`absolute bottom-14 left-2.5 right-2.5 max-h-44 overflow-y-auto rounded-lg border shadow-lg z-30 ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"}`}>
            {matches.map((m) => (
              <button key={m.user_id} type="button" onClick={() => pickMention(m)} className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm ${dark ? "hover:bg-white/5 text-slate-200" : "hover:bg-slate-50 text-slate-700"}`}>
                <UserAvatar url={m.avatar_url || ""} name={m.name || "Member"} size={22} />
                {m.name || "Member"}
              </button>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach" className={`shrink-0 w-9 h-9 rounded-xl inline-flex items-center justify-center ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}>
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          ref={taRef}
          value={draft}
          onChange={onChange}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && mentionQ == null) { e.preventDefault(); submit(); } }}
          rows={1}
          placeholder={placeholder}
          className={`flex-1 resize-none rounded-xl border px-3 py-2 text-sm max-h-32 ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"}`}
        />
        <button type="button" onClick={submit} disabled={!draft.trim() && files.length === 0} aria-label="Send" className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--color-accent)] text-white disabled:opacity-40">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Open conversation ──
function Thread({ conversation, name, memberById, candidates, userId, isAdmin, myOrgTeamLeadIds, onBack, markRead, subscribeMessages, subscribeReactions, onChannelMetaSaved, dark }) {
  const convId = conversation?.id;
  const kind = conversation?.kind || (conversation?.is_group ? "group" : "dm");
  const isChannel = kind === "channel";
  const canManageChannel = isChannel && (isAdmin || myOrgTeamLeadIds?.has(conversation?.org_team_id));
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState(new Map());     // messageId -> Map(emoji -> {count,mine})
  const [attachments, setAttachments] = useState(new Map()); // messageId -> [att]
  const [readMarks, setReadMarks] = useState([]);
  const [editing, setEditing] = useState(null);              // messageId being edited
  const [editDraft, setEditDraft] = useState("");
  const [typers, setTypers] = useState([]);                  // [{user_id, name}]
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef(null);
  const presenceRef = useRef(null);

  const refreshSidecars = useCallback(async (msgs) => {
    const ids = msgs.map((m) => m.id);
    const [rx, at] = await Promise.all([listReactions(ids, userId), listAttachments(ids)]);
    setReactions(rx); setAttachments(at);
  }, [userId]);

  useEffect(() => {
    if (!convId) return;
    let alive = true;
    listMessages(convId).then(async (msgs) => {
      if (!alive) return;
      setMessages(msgs);
      refreshSidecars(msgs);
    });
    listReadMarks(convId).then((m) => alive && setReadMarks(m));
    markRead(convId, kind);
    return () => { alive = false; };
  }, [convId, kind, markRead, refreshSidecars]);

  // live new messages
  useEffect(() => subscribeMessages((m) => {
    if (m.conversation_id !== convId) return;
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    markRead(convId, kind);
    listReadMarks(convId).then(setReadMarks);
  }), [convId, kind, subscribeMessages, markRead]);

  // live reactions
  useEffect(() => subscribeReactions(() => {
    setMessages((cur) => { refreshSidecars(cur); return cur; });
  }), [subscribeReactions, refreshSidecars]);

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

  // presence: typing + online (per conversation)
  useEffect(() => {
    if (!convId || !userId) return;
    const ch = supabase.channel(`presence:conv:${convId}`, { config: { presence: { key: userId } } });
    presenceRef.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
      const t = [];
      for (const key of Object.keys(state)) {
        if (key === userId) continue;
        const meta = state[key][0] || {};
        if (meta.typing) t.push({ user_id: key, name: meta.name });
      }
      setTypers(t);
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED") await ch.track({ typing: false, name: memberById.get(userId)?.name || "Someone" });
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* */ } presenceRef.current = null; };
  }, [convId, userId, memberById]);

  const typingTimer = useRef(null);
  const signalTyping = useCallback(() => {
    const ch = presenceRef.current;
    if (!ch) return;
    ch.track({ typing: true, name: memberById.get(userId)?.name || "Someone" });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => ch.track({ typing: false, name: memberById.get(userId)?.name || "Someone" }), 2500);
  }, [userId, memberById]);

  const onSend = async (body, files) => {
    const text = body || (files.length ? files.map((f) => f.name).join(", ") : "");
    if (!text && !files.length) return;
    const { message } = await sendMessage(convId, text || "📎", userId, kind);
    if (!message) return;
    setMessages((prev) => (prev.some((x) => x.id === message.id) ? prev : [...prev, message]));
    // uploads
    if (files.length) {
      await Promise.all(files.map((f) => attachToMessage(f, convId, message.id)));
      const at = await listAttachments([message.id]);
      setAttachments((prev) => new Map([...prev, ...at]));
    }
    // mentions
    const ids = new Set();
    for (const m of (text.match(/@([\w]+)/g) || [])) {
      const nm = m.slice(1).toLowerCase();
      const hit = candidates.find((c) => (c.name || "").replace(/\s+/g, "").toLowerCase() === nm);
      if (hit && hit.user_id !== userId) ids.add(hit.user_id);
    }
    for (const rid of ids) {
      emitMention({ recipient: rid, title: `${memberById.get(userId)?.name || "Someone"} mentioned you`, body: text.slice(0, 140), payload: { route: "/messages", conversation_id: convId }, entityType: "conversation", entityId: convId });
    }
  };

  const onToggleReaction = async (messageId, emoji, mine) => {
    await toggleReaction(messageId, emoji, userId, mine);
    const rx = await listReactions(messages.map((m) => m.id), userId);
    setReactions(rx);
  };

  const saveEdit = async (messageId) => {
    const body = editDraft.trim();
    if (!body) { setEditing(null); return; }
    const { message } = await editMessage(messageId, body);
    if (message) setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, body: message.body, edited_at: message.edited_at } : m)));
    setEditing(null);
  };

  const onDelete = async (messageId) => {
    if (!window.confirm("Delete this message?")) return;
    await deleteMessage(messageId);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  // seen-by: other members whose read cursor is at/after the last message
  const lastMsg = messages[messages.length - 1];
  const seenBy = useMemo(() => {
    if (!lastMsg) return [];
    return readMarks
      .filter((r) => r.user_id !== userId && r.last_read_at && new Date(r.last_read_at) >= new Date(lastMsg.created_at))
      .map((r) => memberById.get(r.user_id))
      .filter(Boolean);
  }, [readMarks, lastMsg, memberById, userId]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <button type="button" onClick={onBack} className={`p-1.5 rounded-lg ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`} aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        {isChannel ? (
          <Hash className="w-4 h-4 shrink-0" style={{ color: conversation?.org_team_color || "var(--color-accent)" }} />
        ) : conversation?.kind === "group" ? <Users className="w-4 h-4 text-[var(--color-accent)]" /> : null}
        <div className="flex-1 min-w-0">
          <span className={`block text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>{name}</span>
          {isChannel && conversation?.topic && <span className={`block text-[11px] truncate ${dark ? "text-slate-500" : "text-slate-400"}`}>{conversation.topic}</span>}
        </div>
        {conversation?.post_policy === "admins" && <Megaphone className="w-3.5 h-3.5 text-amber-500" aria-label="Announcement channel" />}
        {canManageChannel && (
          <button type="button" onClick={() => setShowSettings((v) => !v)} aria-label="Channel settings" className={`p-1.5 rounded-lg ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}>
            <Settings2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {showSettings && canManageChannel && (
        <ChannelSettings conversation={conversation} memberById={memberById} dark={dark} onClose={() => setShowSettings(false)} onSaved={onChannelMetaSaved} />
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 && (
          <div className={`text-center text-sm py-10 ${dark ? "text-slate-500" : "text-slate-400"}`}>No messages yet — say hi.</div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          const author = memberById.get(m.sender_id);
          const atts = attachments.get(m.id) || [];
          return (
            <div key={m.id} className={`flex gap-2 group ${mine ? "flex-row-reverse" : ""}`}>
              {!mine && <UserAvatar url={author?.avatar_url || ""} name={author?.name || "Member"} size={26} />}
              <div className="max-w-[78%]">
                <div className={`rounded-2xl px-3 py-1.5 text-sm ${
                  mine ? "bg-[var(--color-accent)] text-white"
                  : dark ? "bg-[var(--color-surface-raised)] text-slate-100" : "bg-slate-100 text-slate-800"
                }`}>
                  {!mine && (conversation?.kind === "group" || isChannel) && <div className="text-[11px] font-semibold opacity-70 mb-0.5">{author?.name || "Member"}</div>}
                  {editing === m.id ? (
                    <div className="flex flex-col gap-1">
                      <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={2} className="rounded-lg border px-2 py-1 text-sm text-slate-800" />
                      <div className="flex gap-2 text-[11px]"><button onClick={() => saveEdit(m.id)} className="font-semibold">Save</button><button onClick={() => setEditing(null)}>Cancel</button></div>
                    </div>
                  ) : (
                    <>
                      <Body text={m.body} />
                      {atts.map((a) => (
                        isImage(a.mime)
                          ? <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"><img src={a.url} alt="" className="mt-1 max-h-56 rounded-lg" /></a>
                          : <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] underline"><Paperclip className="w-3 h-3" />Attachment</a>
                      ))}
                      <div className={`text-[10px] mt-0.5 ${mine ? "text-white/70" : dark ? "text-slate-500" : "text-slate-400"}`}>
                        {timeShort(m.created_at)}{m.edited_at ? " · edited" : ""}
                      </div>
                    </>
                  )}
                </div>
                <div className={`flex items-center gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                  <ReactionBar reactions={reactions.get(m.id)} onToggle={(emoji, isMine) => onToggleReaction(m.id, emoji, isMine)} dark={dark} />
                  {mine && editing !== m.id && (
                    <span className="opacity-0 group-hover:opacity-100 flex gap-1">
                      <button onClick={() => { setEditing(m.id); setEditDraft(m.body); }} aria-label="Edit"><Pencil className="w-3 h-3 text-slate-400" /></button>
                      <button onClick={() => onDelete(m.id)} aria-label="Delete"><Trash2 className="w-3 h-3 text-slate-400" /></button>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {seenBy.length > 0 && (
          <div className="flex items-center justify-end gap-1 pr-1">
            <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>Seen</span>
            {seenBy.slice(0, 5).map((u) => <UserAvatar key={u.user_id} url={u.avatar_url || ""} name={u.name || "Member"} size={14} />)}
          </div>
        )}
        {typers.length > 0 && (
          <div className={`text-[11px] italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {typers.map((t) => t.name || "Someone").join(", ")} {typers.length === 1 ? "is" : "are"} typing…
          </div>
        )}
      </div>

      <ComposerWithTyping onSend={onSend} candidates={candidates} dark={dark} onTyping={signalTyping}
        placeholder={conversation?.post_policy === "admins" && !canManageChannel ? "Only admins can post here" : "Message…"}
        disabled={conversation?.post_policy === "admins" && !canManageChannel} />
    </div>
  );
}

// Composer wrapper that also emits typing presence on keystroke.
function ComposerWithTyping({ onSend, candidates, dark, onTyping, placeholder, disabled }) {
  if (disabled) {
    return <div className={`border-t shrink-0 px-3 py-3 text-center text-[12px] ${dark ? "border-[var(--color-border)] text-slate-500" : "border-slate-200 text-slate-400"}`}>{placeholder}</div>;
  }
  return (
    <div onKeyDown={onTyping}>
      <Composer onSend={onSend} candidates={candidates} dark={dark} placeholder={placeholder} />
    </div>
  );
}

// ── channel settings (admin/lead) ──
function ChannelSettings({ conversation, memberById, dark, onClose, onSaved }) {
  const [title, setTitle] = useState(conversation.title || "");
  const [topic, setTopic] = useState(conversation.topic || "");
  const [policy, setPolicy] = useState(conversation.post_policy || "all");
  const [busy, setBusy] = useState(false);
  const { teamsByUserId } = useTeam();
  // Roster: members of this org_team (from the shared teamsByUserId map).
  const roster = useMemo(() => {
    const out = [];
    for (const [uid, teams] of (teamsByUserId || new Map())) {
      if (teams.some((t) => t.id === conversation.org_team_id)) {
        const m = memberById.get(uid);
        if (m) out.push(m);
      }
    }
    return out;
  }, [teamsByUserId, conversation.org_team_id, memberById]);

  const save = async () => {
    setBusy(true);
    await setChannelMeta(conversation.id, { title, topic, postPolicy: policy });
    await onSaved?.();
    setBusy(false);
    onClose();
  };
  return (
    <div className={`px-3 py-3 border-b space-y-2 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]" : "border-slate-200 bg-slate-50"}`}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Channel name" className={`w-full rounded-lg border px-3 py-2 text-sm ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"}`} />
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic / description" className={`w-full rounded-lg border px-3 py-2 text-sm ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"}`} />
      <label className={`flex items-center gap-2 text-xs ${dark ? "text-slate-300" : "text-slate-700"}`}>
        <input type="checkbox" checked={policy === "admins"} onChange={(e) => setPolicy(e.target.checked ? "admins" : "all")} />
        Announcement channel (only admins/leads can post)
      </label>
      <div className="flex items-center justify-between">
        <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{roster.length} members</span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="text-sm">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="text-sm font-semibold text-[var(--color-accent)]">{busy ? "…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ── New message (DM / group / channel) ──
function NewMessage({ others, orgTeams, leadOrAdminTeamIds, onCancel, onStartDm, onCreateGroup, onCreateChannel, dark }) {
  const [mode, setMode] = useState("people"); // 'people' | 'channel'
  const [picked, setPicked] = useState([]);
  const [title, setTitle] = useState("");
  const [chanTeam, setChanTeam] = useState("");
  const [chanName, setChanName] = useState("");
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const creatableTeams = orgTeams.filter((t) => leadOrAdminTeamIds.has(t.id));

  const go = async () => {
    if (mode === "channel") { if (chanTeam && chanName.trim()) await onCreateChannel(chanTeam, chanName.trim()); return; }
    if (picked.length === 0) return;
    if (picked.length === 1) await onStartDm(picked[0]);
    else await onCreateGroup(title, picked);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center justify-between px-3 py-2.5 border-b shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <button type="button" onClick={onCancel} className={`p-1.5 rounded-lg ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`} aria-label="Back"><ArrowLeft className="w-4 h-4" /></button>
        <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>New {mode === "channel" ? "channel" : "message"}</span>
        <button type="button" onClick={go} disabled={mode === "channel" ? (!chanTeam || !chanName.trim()) : picked.length === 0} className="text-sm font-semibold text-[var(--color-accent)] disabled:opacity-40">
          {mode === "channel" ? "Create" : picked.length > 1 ? "Create" : "Start"}
        </button>
      </div>

      {creatableTeams.length > 0 && (
        <div className="flex gap-1 px-3 pt-2.5 shrink-0">
          <button type="button" onClick={() => setMode("people")} className={`px-2.5 h-7 rounded-full text-[12px] font-semibold ${mode === "people" ? "bg-[var(--color-accent)] text-white" : dark ? "bg-white/5 text-slate-300" : "bg-slate-100 text-slate-600"}`}>People</button>
          <button type="button" onClick={() => setMode("channel")} className={`px-2.5 h-7 rounded-full text-[12px] font-semibold inline-flex items-center gap-1 ${mode === "channel" ? "bg-[var(--color-accent)] text-white" : dark ? "bg-white/5 text-slate-300" : "bg-slate-100 text-slate-600"}`}><Hash className="w-3 h-3" />Channel</button>
        </div>
      )}

      {mode === "channel" ? (
        <div className="p-3 space-y-2">
          <select value={chanTeam} onChange={(e) => setChanTeam(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"}`}>
            <option value="">Choose a team…</option>
            {creatableTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input value={chanName} onChange={(e) => setChanName(e.target.value.slice(0, 40))} placeholder="Channel name" className={`w-full rounded-lg border px-3 py-2 text-sm ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"}`} />
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

// ── one conversation row ──
function Row({ c, nameOf, memberById, onOpen, onPin, onMute, dark }) {
  const first = memberById.get(c.participant_ids[0]);
  const muted = !!c.muted_at;
  return (
    <div className={`group w-full flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0 transition-colors ${dark ? "hover:bg-white/5 border-[var(--color-border)]" : "hover:bg-slate-50 border-slate-100"}`}>
      <button type="button" onClick={() => onOpen(c.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        {c.kind === "channel" ? (
          <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: `${c.org_team_color || "#14b8a6"}22`, color: c.org_team_color || "#14b8a6" }}><Hash className="w-4 h-4" /></span>
        ) : c.kind === "group" ? (
          <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-200 text-slate-600"}`}><Users className="w-4 h-4" /></span>
        ) : (
          <UserAvatar url={first?.avatar_url || ""} name={first?.name || "Member"} size={36} />
        )}
        <span className="flex-1 min-w-0">
          <span className={`flex items-center gap-1 text-sm font-semibold truncate ${dark ? "text-slate-200" : "text-slate-800"}`}>
            {c.pinned_at && <Pin className="w-3 h-3 opacity-60" />}{nameOf(c)}
          </span>
          <span className={`block text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{timeShort(c.last_message_at)}</span>
        </span>
      </button>
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
        <button type="button" onClick={() => onPin(c)} aria-label={c.pinned_at ? "Unpin" : "Pin"} className={`p-1 rounded ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"}`}>{c.pinned_at ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}</button>
        <button type="button" onClick={() => onMute(c)} aria-label={muted ? "Unmute" : "Mute"} className={`p-1 rounded ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-400 hover:bg-slate-100"}`}>{muted ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}</button>
      </div>
      {c.unread && !muted && <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />}
    </div>
  );
}

// ── sectioned conversation list ──
function List({ conversations, nameOf, memberById, onOpen, onNew, onPin, onMute, dark }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = conversations;
    if (needle) list = list.filter((c) => nameOf(c).toLowerCase().includes(needle));
    // pinned first, then recency (list already arrives recency-sorted)
    return [...list].sort((a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0));
  }, [conversations, q, nameOf]);

  const sections = [
    { key: "channel", label: "Channels", items: filtered.filter((c) => c.kind === "channel") },
    { key: "group", label: "Group chats", items: filtered.filter((c) => c.kind === "group") },
    { key: "dm", label: "Direct messages", items: filtered.filter((c) => c.kind === "dm" || (!c.kind && !c.is_group)) },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center justify-between px-3 py-2.5 border-b shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <span className={`text-base font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Messages</span>
        <button type="button" onClick={onNew} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full bg-[var(--color-accent)] text-white text-[12px] font-semibold">
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      </div>
      <div className={`px-3 py-2 border-b shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <div className={`flex items-center gap-2 rounded-lg px-2.5 h-8 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"}`}>
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" className={`flex-1 bg-transparent text-sm outline-none ${dark ? "text-slate-100 placeholder:text-slate-500" : "text-slate-800 placeholder:text-slate-400"}`} />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 && (
          <div className={`flex flex-col items-center justify-center gap-2 py-16 text-center ${dark ? "text-slate-500" : "text-slate-400"}`}>
            <MessageSquare className="w-7 h-7 opacity-60" />
            <p className="text-sm">No conversations yet.</p>
            <button type="button" onClick={onNew} className="text-[var(--color-accent)] text-sm font-semibold">Start one</button>
          </div>
        )}
        {sections.map((s) => s.items.length > 0 && (
          <div key={s.key}>
            <div className={`px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>{s.label}</div>
            {s.items.map((c) => <Row key={c.id} c={c} nameOf={nameOf} memberById={memberById} onOpen={onOpen} onPin={onPin} onMute={onMute} dark={dark} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { session } = useApp();
  const userId = session?.user?.id;
  const { teamMembers = [], orgTeams = [], myOrgTeamLeadIds = new Set(), isAdmin } = useTeam();
  const { conversations = [], activeConversations = [], startDm, createGroup, createChannel, markRead, subscribeMessages, subscribeReactions, reload } = useMessages();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c") || null;
  const [composing, setComposing] = useState(false);

  const memberById = useMemo(() => new Map(teamMembers.map((m) => [m.user_id, m])), [teamMembers]);
  const others = useMemo(() => teamMembers.filter((m) => m.user_id !== userId), [teamMembers, userId]);
  const leadOrAdminTeamIds = useMemo(() => {
    if (isAdmin) return new Set(orgTeams.map((t) => t.id));
    return myOrgTeamLeadIds;
  }, [isAdmin, orgTeams, myOrgTeamLeadIds]);

  const nameOf = (c) => {
    if (!c) return "Conversation";
    if (c.kind === "channel") return c.title || "channel";
    if (c.kind === "group") return c.title || (c.participant_ids.map((id) => memberById.get(id)?.name || "Member").join(", ") || "Group");
    return memberById.get(c.participant_ids[0])?.name || "Member";
  };

  const open = (id) => setParams(id ? { c: id } : {}, { replace: true });
  const active = activeConversations.find((c) => c.id === activeId) || conversations.find((c) => c.id === activeId) || (activeId ? { id: activeId, kind: "dm", participant_ids: [] } : null);

  const onPin = async (c) => { await setConversationPinned(c.id, userId, !c.pinned_at, c.kind); reload?.(); };
  const onMute = async (c) => { await setConversationMuted(c.id, userId, !c.muted_at, c.kind); reload?.(); };

  return (
    <div className={`mx-auto w-full max-w-2xl h-[calc(100dvh-3.5rem)] flex flex-col rounded-none sm:rounded-xl sm:my-3 sm:h-[calc(100dvh-5rem)] overflow-hidden sm:border ${dark ? "bg-[var(--color-surface)] sm:border-[var(--color-border)]" : "bg-white sm:border-slate-200"}`}>
      {activeId ? (
        <Thread
          conversation={active} name={nameOf(active)} memberById={memberById} candidates={others}
          userId={userId} isAdmin={isAdmin} myOrgTeamLeadIds={myOrgTeamLeadIds}
          onBack={() => open(null)} markRead={markRead}
          subscribeMessages={subscribeMessages} subscribeReactions={subscribeReactions} onChannelMetaSaved={reload} dark={dark}
        />
      ) : composing ? (
        <NewMessage
          others={others} orgTeams={orgTeams} leadOrAdminTeamIds={leadOrAdminTeamIds}
          onCancel={() => setComposing(false)}
          onStartDm={async (id) => { const cid = await startDm(id); setComposing(false); if (cid) open(cid); }}
          onCreateGroup={async (title, ids) => { const cid = await createGroup(title, ids); setComposing(false); if (cid) open(cid); }}
          onCreateChannel={async (teamId, name) => { const cid = await createChannel(teamId, name); setComposing(false); if (cid) open(cid); }}
          dark={dark}
        />
      ) : (
        <List conversations={activeConversations} nameOf={nameOf} memberById={memberById} onOpen={open} onNew={() => setComposing(true)} onPin={onPin} onMute={onMute} dark={dark} />
      )}
    </div>
  );
}
