import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { X, AlertTriangle, UserMinus } from "lucide-react";
import UserAvatar from "./UserAvatar";

// Confirmation modal for removing a member from the org. Spells out
// exactly what stays and what goes so admins aren't guessing — the
// previous design removed on a single click with no guard.
export default function RemoveMemberModal({
  open, onClose, member, orgName, busy, onConfirm,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  if (!open || !member) return null;

  const cardCls = `relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
    dark ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
  }`;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div className={cardCls} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-lg shrink-0 ${
            dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600"
          }`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
              Remove from {orgName}?
            </h2>
            <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
              This action is reversible — you can re-invite later.
            </p>
          </div>
        </div>

        {/* Member preview */}
        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-4 ${
          dark ? "bg-slate-800/40" : "bg-slate-50"
        }`}>
          <UserAvatar url={member.avatar_url} name={member.name} size={36} />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {member.name}
            </p>
            <p className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {member.role === "admin" ? "Admin" : "Member"}
            </p>
          </div>
        </div>

        {/* What happens */}
        <div className={`rounded-lg border p-3 mb-4 ${
          dark ? "bg-slate-800/30 border-slate-700/60" : "bg-slate-50 border-slate-200"
        }`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${
            dark ? "text-slate-400" : "text-slate-500"
          }`}>
            What happens
          </p>
          <ul className={`text-xs space-y-1.5 ${dark ? "text-slate-300" : "text-slate-700"}`}>
            <li className="flex items-start gap-1.5">
              <span className={dark ? "text-emerald-400" : "text-emerald-600"}>•</span>
              Their retro cards stay attributed to them.
            </li>
            <li className="flex items-start gap-1.5">
              <span className={dark ? "text-rose-400" : "text-rose-600"}>•</span>
              They lose access to every room, retro, and team in this org.
            </li>
            <li className="flex items-start gap-1.5">
              <span className={dark ? "text-rose-400" : "text-rose-600"}>•</span>
              Their team memberships (SWE, PM, etc.) are removed.
            </li>
            <li className="flex items-start gap-1.5">
              <span className={dark ? "text-rose-400" : "text-rose-600"}>•</span>
              HR fields (classification, rate, target hours) are deleted.
            </li>
          </ul>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={dark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
          >
            <UserMinus className="w-4 h-4 mr-1.5" />
            {busy ? "Removing…" : `Remove ${member.name.split(" ")[0] || "member"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
