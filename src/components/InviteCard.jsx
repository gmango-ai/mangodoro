import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Mail, RefreshCw, Sparkles, Check } from "lucide-react";

// Prominent invite card. Lives at the top of /team because the single
// most important action for a new org is bringing in teammates — the
// previous design buried it three sections deep. Stays visible even
// for established orgs because the same admins keep needing to share
// the link when someone new joins.
export default function InviteCard({
  dark, team, isAdmin, onCopyCode, onCopyLink, onRegenerate, copiedCode, copiedLink,
}) {
  const [emailDraft, setEmailDraft] = useState("");

  const cardCls = `rounded-2xl border p-5 sm:p-6 ${
    dark
      ? "bg-gradient-to-br from-cyan-500/10 via-slate-900/60 to-slate-900 border-cyan-500/30"
      : "bg-gradient-to-br from-teal-50 via-white to-white border-teal-200"
  }`;

  function handleEmail() {
    const subject = encodeURIComponent(`Join ${team.name} on Mangodoro`);
    const link = `${window.location.origin}/team/join/${team.invite_code}`;
    const body = encodeURIComponent(
      `Hey,\n\nI added you to my org "${team.name}" on Mangodoro. Use this link to join:\n\n${link}\n\nOr the invite code: ${team.invite_code}`,
    );
    const href = `mailto:${encodeURIComponent(emailDraft.trim())}?subject=${subject}&body=${body}`;
    window.open(href, "_blank", "noopener");
  }

  return (
    <div className={cardCls}>
      <div className="flex items-start gap-3 mb-4">
        <div className={`p-2 rounded-lg shrink-0 ${dark ? "bg-cyan-500/15 text-cyan-300" : "bg-teal-100 text-teal-700"}`}>
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={`text-sm font-bold uppercase tracking-wider ${
            dark ? "text-cyan-200" : "text-teal-700"
          }`}>
            Invite people
          </h2>
          <p className={`text-xs mt-0.5 ${dark ? "text-slate-300" : "text-slate-600"}`}>
            Share the link or send a quick email — they'll land directly in {team.name}.
          </p>
        </div>
      </div>

      {/* Action buttons row */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Button onClick={onCopyLink} className="flex-1 min-w-[140px]">
          {copiedLink
            ? <><Check className="w-4 h-4 mr-1.5" /> Link copied!</>
            : <><Copy className="w-4 h-4 mr-1.5" /> Copy invite link</>}
        </Button>
        <Button variant="outline" onClick={onCopyCode} className="flex-1 min-w-[140px]">
          {copiedCode
            ? <><Check className="w-4 h-4 mr-1.5" /> Code copied!</>
            : <><Copy className="w-4 h-4 mr-1.5" /> Copy code</>}
        </Button>
      </div>

      {/* Email a teammate */}
      <div className={`rounded-lg border p-2.5 flex flex-wrap items-center gap-2 ${
        dark ? "bg-slate-900/40 border-slate-700/60" : "bg-white border-slate-200"
      }`}>
        <input
          type="email"
          value={emailDraft}
          onChange={(e) => setEmailDraft(e.target.value)}
          placeholder="teammate@example.com"
          className={`flex-1 min-w-[180px] bg-transparent text-sm outline-none ${
            dark ? "text-slate-100 placeholder:text-slate-500" : "text-slate-800 placeholder:text-slate-400"
          }`}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleEmail}
          disabled={!emailDraft.trim()}
        >
          <Mail className="w-3.5 h-3.5 mr-1.5" /> Send email
        </Button>
      </div>

      {/* Footer: code + regenerate */}
      <div className={`flex items-center justify-between mt-3 px-1 text-[11px] ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}>
        <span>
          Code:{" "}
          <code className={`font-mono font-bold tracking-widest ${
            dark ? "text-cyan-300" : "text-teal-700"
          }`}>
            {team.invite_code}
          </code>
        </span>
        {isAdmin && (
          <button
            type="button"
            onClick={onRegenerate}
            className={`inline-flex items-center gap-1 underline ${
              dark ? "hover:text-slate-200" : "hover:text-slate-700"
            }`}
          >
            <RefreshCw className="w-3 h-3" /> Regenerate
          </button>
        )}
      </div>
    </div>
  );
}
