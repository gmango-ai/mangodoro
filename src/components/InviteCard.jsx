import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Mail, RefreshCw, Sparkles, Check, ChevronDown } from "lucide-react";
import { getShareableBaseUrl } from "../lib/platform";

// Prominent invite card. Lives at the top of /team because the single
// most important action for a new org is bringing in teammates — the
// previous design buried it three sections deep.
//
// For larger orgs (memberCount > 5) the card collapses to a single
// line by default — the visual loudness only helps when adding people
// is the dominant action, which is true for new orgs but noise for
// established ones. Click the row to expand the full form.
export default function InviteCard({
  dark, team, isAdmin, memberCount = 1,
  onCopyCode, onCopyLink, onRegenerate, copiedCode, copiedLink,
}) {
  const shouldCollapseByDefault = memberCount > 5;
  const [expanded, setExpanded] = useState(!shouldCollapseByDefault);
  const [emailDraft, setEmailDraft] = useState("");

  // --- Collapsed (compact) variant ---
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors text-left ${
          dark
            ? "bg-[var(--color-bg)] border-[var(--color-border)] hover:bg-[var(--color-surface-raised)] hover:border-[var(--color-accent)]"
            : "bg-white border-slate-200 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-light)]"
        }`}
        aria-expanded="false"
        aria-label="Invite people to this org"
      >
        <div className={`p-1.5 rounded-md shrink-0 ${
          "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
        }`}>
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <span className={`flex-1 text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>
          Invite people
        </span>
        <code className={`hidden sm:inline font-mono text-[11px] tracking-widest ${
          "text-[var(--color-accent)]"
        }`}>
          {team.invite_code}
        </code>
        <ChevronDown className={`w-4 h-4 ${dark ? "text-slate-500" : "text-slate-400"}`} />
      </button>
    );
  }

  // --- Expanded (full) variant ---
  function handleEmail() {
    const subject = encodeURIComponent(`Join ${team.name} on Mangodoro`);
    const link = `${getShareableBaseUrl()}/team/join/${team.invite_code}`;
    const body = encodeURIComponent(
      `Hey,\n\nI added you to my org "${team.name}" on Mangodoro. Use this link to join:\n\n${link}\n\nOr the invite code: ${team.invite_code}`,
    );
    const href = `mailto:${encodeURIComponent(emailDraft.trim())}?subject=${subject}&body=${body}`;
    window.open(href, "_blank", "noopener");
  }

  const cardCls = `rounded-2xl border p-5 sm:p-6 ${
    dark
      ? "bg-gradient-to-br from-[var(--color-accent-light)] via-slate-900/60 to-slate-900 border-[var(--color-accent)]"
      : "bg-gradient-to-br from-[var(--color-accent-light)] via-white to-white border-[var(--color-accent-border)]"
  }`;

  return (
    <div className={cardCls}>
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-lg shrink-0 bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={`text-sm font-bold uppercase tracking-wider ${
            "text-[var(--color-accent)]"
          }`}>
            Invite people
          </h2>
          <p className={`text-xs mt-0.5 ${dark ? "text-slate-300" : "text-slate-600"}`}>
            Share the link or send a quick email — they'll land directly in {team.name}.
          </p>
        </div>
        {/* Allow collapse for established orgs once they've expanded. */}
        {shouldCollapseByDefault && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className={`text-[11px] underline shrink-0 ${
              dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Collapse
          </button>
        )}
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
        dark ? "bg-[var(--color-bg)] border-[var(--color-border)]" : "bg-white border-slate-200"
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
            "text-[var(--color-accent)]"
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
