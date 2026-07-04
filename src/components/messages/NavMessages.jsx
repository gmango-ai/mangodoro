import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Users, ExternalLink, Folder } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMessages } from "../../context/MessagesContext";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import UserAvatar from "../UserAvatar";
import { Thread, conversationName, channelGlyph, listStamp } from "../../pages/MessagesPage";

// One recent-conversation row in the quick view: kind icon/avatar, name, last
// activity stamp, and an unread dot.
function QuickRow({ c, memberById, onOpen, dark }) {
  const kind = c.kind || (c.is_group ? "group" : "dm");
  const name = conversationName(c, memberById);
  const first = memberById.get(c.participant_ids?.[0]);
  const unread = c.unread && !c.muted_at;
  return (
    <button
      type="button"
      onClick={() => onOpen(c)}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${dark ? "hover:bg-white/5" : "hover:bg-slate-50"}`}
    >
      {kind === "channel" ? (
        <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${c.org_team_color || "#14b8a6"}22`, color: c.org_team_color || "#14b8a6" }}>{channelGlyph(c)}</span>
      ) : kind === "group" ? (
        <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-200 text-slate-600"}`}><Users className="w-4 h-4" /></span>
      ) : (
        <UserAvatar url={first?.avatar_url || ""} name={first?.name || name} size={32} />
      )}
      <span className="flex-1 min-w-0">
        <span className={`block text-[13px] font-semibold truncate ${dark ? "text-slate-200" : "text-slate-800"}`}>{name}</span>
        {c.last_message_at && <span className={`block text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{listStamp(c.last_message_at)}</span>}
      </span>
      {unread && <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" aria-label="Unread" />}
    </button>
  );
}

// Nav entry to messages: an unread badge plus a quick-view popover of your most
// recent chats / room channels. Clicking one opens the full thread inline (with
// a button to jump to the full Messages page); a header link opens the page.
export default function NavMessages() {
  const { session } = useApp();
  const userId = session?.user?.id;
  const { teamMembers = [], orgTeams = [], myOrgTeamLeadIds = new Set(), isAdmin } = useTeam();
  const { activeConversations = [], unread, folders = [], markRead, subscribeMessages, subscribeReactions, reload } = useMessages();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);

  const memberById = useMemo(() => new Map(teamMembers.map((m) => [m.user_id, m])), [teamMembers]);
  const others = useMemo(() => teamMembers.filter((m) => m.user_id !== userId), [teamMembers, userId]);

  // Channels grouped into their shared folders (mirrors the sidebar), plus a
  // recency-sorted shortlist of DMs / group chats.
  const { folderSections, ungroupedChannels, recentsDM } = useMemo(() => {
    const fIds = new Set(folders.map((f) => f.id));
    const byPos = (a, b) => (a.folder_position - b.folder_position) || (new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
    const chans = activeConversations.filter((c) => c.kind === "channel");
    const sections = folders.map((f) => ({ folder: f, items: chans.filter((c) => c.folder_id === f.id).sort(byPos) })).filter((s) => s.items.length);
    const ungrouped = chans.filter((c) => !c.folder_id || !fIds.has(c.folder_id)).sort(byPos);
    const dms = activeConversations.filter((c) => c.kind !== "channel").sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)).slice(0, 10);
    return { folderSections: sections, ungroupedChannels: ungrouped, recentsDM: dms };
  }, [activeConversations, folders]);
  const active = activeConversations.find((c) => c.id === activeId) || null;

  // Close on outside click; reset to the list whenever it closes.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  useEffect(() => { if (!open) setActiveId(null); }, [open]);

  const openFull = (id) => { setOpen(false); navigate(id ? `/messages?c=${id}` : "/messages"); };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Messages"
        aria-label="Messages"
        className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-colors ${dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"}`}
      >
        <MessageSquare className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-[380px] max-w-[94vw] h-[540px] max-h-[80vh] rounded-2xl border shadow-2xl overflow-hidden z-50 flex flex-col"
          style={{ background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
        >
          {active ? (
            <Thread
              key={active.id}
              conversation={active}
              name={conversationName(active, memberById)}
              memberById={memberById}
              candidates={others}
              userId={userId}
              isAdmin={isAdmin}
              myOrgTeamLeadIds={myOrgTeamLeadIds}
              onBack={() => setActiveId(null)}
              onOpenFull={() => openFull(active.id)}
              onOpenRoom={active.room_id ? () => { setOpen(false); navigate(`/office/r/${active.room_id}`); } : undefined}
              markRead={markRead}
              subscribeMessages={subscribeMessages}
              subscribeReactions={subscribeReactions}
              onChannelMetaSaved={reload}
              dark={dark}
            />
          ) : (
            <>
              <div className="flex items-center justify-between px-3 h-12 shrink-0 border-b" style={{ borderColor: dark ? "var(--color-border)" : "rgb(241,245,249)" }}>
                <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Messages</span>
                <button type="button" onClick={() => openFull(null)} className={`text-xs inline-flex items-center gap-1 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
                  Open full <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto py-1">
                {activeConversations.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center gap-2 py-16 text-center ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    <MessageSquare className="w-7 h-7 opacity-60" />
                    <p className="text-sm">No conversations yet.</p>
                    <button type="button" onClick={() => openFull(null)} className="text-[var(--color-accent)] text-sm font-semibold">Start one</button>
                  </div>
                ) : (
                  <>
                    {folderSections.map((s) => (
                      <div key={s.folder.id} className="mb-0.5">
                        <div className={`flex items-center gap-1.5 px-3 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>
                          <Folder className="w-3.5 h-3.5" /> <span className="truncate">{s.folder.name}</span>
                        </div>
                        {s.items.map((c) => <QuickRow key={c.id} c={c} memberById={memberById} onOpen={(x) => setActiveId(x.id)} dark={dark} />)}
                      </div>
                    ))}
                    {ungroupedChannels.length > 0 && (
                      <div className="mb-0.5">
                        {folderSections.length > 0 && <div className={`px-3 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>Channels</div>}
                        {ungroupedChannels.map((c) => <QuickRow key={c.id} c={c} memberById={memberById} onOpen={(x) => setActiveId(x.id)} dark={dark} />)}
                      </div>
                    )}
                    {recentsDM.length > 0 && (
                      <div>
                        <div className={`px-3 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>Direct messages</div>
                        {recentsDM.map((c) => <QuickRow key={c.id} c={c} memberById={memberById} onOpen={(x) => setActiveId(x.id)} dark={dark} />)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
