import { useState, useEffect } from "react";
import { useTheme } from "../context/ThemeContext";
import { Crown, X, ShieldCheck, Trash2 } from "lucide-react";

export default function SyncParticipantList({
  participants,
  leaderId,
  presenceMap,
  currentUserId,
  onTransferLeader,
  onKickParticipant,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [selectedId, setSelectedId] = useState(null);
  const [confirming, setConfirming] = useState(null); // 'transfer' | 'kick' | null

  const viewerIsLeader = currentUserId && currentUserId === leaderId;
  const selected = participants?.find((p) => p.user_id === selectedId) || null;

  // Clear selection when participants list changes (e.g. someone left)
  useEffect(() => {
    if (selectedId && !participants?.some((p) => p.user_id === selectedId)) {
      setSelectedId(null);
      setConfirming(null);
    }
  }, [participants, selectedId]);

  // Close on Escape
  useEffect(() => {
    if (!selectedId) return;
    function onKey(e) {
      if (e.key === "Escape") { setSelectedId(null); setConfirming(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  if (!participants?.length) return null;

  function handleAvatarClick(p) {
    if (!viewerIsLeader) return;
    if (p.user_id === leaderId) return; // can't act on self/leader
    if (p.user_id === currentUserId) return;
    setConfirming(null);
    setSelectedId((cur) => (cur === p.user_id ? null : p.user_id));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {participants.map((p) => {
          const isLeader = p.user_id === leaderId;
          const isSelf = p.user_id === currentUserId;
          const isOnline = presenceMap?.[p.user_id] ?? false;
          const isSelected = selectedId === p.user_id;
          const initial = (p.display_name || "?")[0].toUpperCase();
          const isClickable = viewerIsLeader && !isLeader && !isSelf;

          return (
            <button
              key={p.user_id}
              type="button"
              onClick={() => handleAvatarClick(p)}
              disabled={!isClickable}
              title={`${p.display_name || "Member"}${isLeader ? " (Leader)" : ""}${isOnline ? "" : " (Offline)"}${isClickable ? " — tap to manage" : ""}`}
              className={`relative flex flex-col items-center ${isClickable ? "cursor-pointer" : "cursor-default"}`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all ${
                  isSelected
                    ? dark ? "ring-2 ring-cyan-400 border-cyan-400" : "ring-2 ring-teal-500 border-teal-500"
                    : ""
                } ${
                  isLeader
                    ? dark
                      ? "bg-cyan-500/30 text-cyan-300 border-cyan-500/50"
                      : "bg-teal-100 text-teal-700 border-teal-400"
                    : dark
                      ? "bg-slate-800 text-slate-400 border-slate-600 hover:border-cyan-500/50"
                      : "bg-slate-100 text-slate-500 border-slate-300 hover:border-teal-400"
                }`}
              >
                {initial}
              </div>
              {isLeader && (
                <div
                  className={`absolute -top-1.5 -right-1 rounded-full p-0.5 ${
                    dark ? "bg-slate-900" : "bg-white"
                  }`}
                >
                  <Crown
                    className={`w-2.5 h-2.5 ${dark ? "text-amber-300" : "text-amber-500"}`}
                    fill="currentColor"
                  />
                </div>
              )}
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${
                  dark ? "border-slate-900" : "border-white"
                } ${isOnline ? "bg-emerald-400" : "bg-slate-400"}`}
              />
              <span
                className={`text-[9px] mt-1 max-w-[3.5rem] truncate ${
                  isSelected
                    ? dark ? "text-cyan-300" : "text-teal-700"
                    : dark ? "text-slate-500" : "text-slate-400"
                }`}
              >
                {isSelf ? "You" : (p.display_name || "—")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Inline action popover */}
      {viewerIsLeader && selected && (
        <div
          className={`rounded-md border p-2 text-xs ${
            dark
              ? "bg-slate-900/80 border-cyan-500/30 shadow-lg shadow-cyan-500/10"
              : "bg-white border-teal-300 shadow-lg shadow-teal-500/10"
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className={`font-semibold truncate ${dark ? "text-slate-200" : "text-slate-700"}`}>
              {selected.display_name || "Member"}
            </span>
            <button
              type="button"
              onClick={() => { setSelectedId(null); setConfirming(null); }}
              aria-label="Close"
              className={`p-0.5 rounded ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {confirming === "transfer" ? (
            <ConfirmRow
              dark={dark}
              prompt={`Transfer leadership to ${selected.display_name || "this member"}?`}
              confirmLabel="Yes, transfer"
              confirmTone="primary"
              onConfirm={() => {
                onTransferLeader?.(selected.user_id);
                setSelectedId(null); setConfirming(null);
              }}
              onCancel={() => setConfirming(null)}
            />
          ) : confirming === "kick" ? (
            <ConfirmRow
              dark={dark}
              prompt={`Remove ${selected.display_name || "this member"} from the session?`}
              confirmLabel="Remove"
              confirmTone="danger"
              onConfirm={() => {
                onKickParticipant?.(selected.user_id);
                setSelectedId(null); setConfirming(null);
              }}
              onCancel={() => setConfirming(null)}
            />
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setConfirming("transfer")}
                disabled={!onTransferLeader}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                  dark
                    ? "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                    : "bg-teal-50 text-teal-700 hover:bg-teal-100"
                }`}
              >
                <ShieldCheck className="w-3 h-3" /> Make leader
              </button>
              <button
                type="button"
                onClick={() => setConfirming("kick")}
                disabled={!onKickParticipant}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                  dark
                    ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
                    : "bg-red-50 text-red-600 hover:bg-red-100"
                }`}
              >
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfirmRow({ dark, prompt, confirmLabel, confirmTone, onConfirm, onCancel }) {
  const confirmCls =
    confirmTone === "danger"
      ? dark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-600 hover:bg-red-500 text-white"
      : dark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-teal-600 hover:bg-teal-500 text-white";
  return (
    <div className="space-y-1.5">
      <p className={`text-[11px] ${dark ? "text-slate-300" : "text-slate-600"}`}>{prompt}</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          className={`flex-1 px-2 py-1 rounded-md text-[11px] font-semibold ${confirmCls}`}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`flex-1 px-2 py-1 rounded-md text-[11px] font-semibold ${
            dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
