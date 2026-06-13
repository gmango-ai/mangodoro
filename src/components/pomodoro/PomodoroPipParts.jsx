import ConfirmRow from "../ConfirmRow";

export const PIP_VIEW_SIZES = {
  timer: { w: 260, h: 180 },
  controls: { w: 260, h: 200 },
  full: { w: 360, h: 520 },
};

export const PIP_CONFIRM_EXTRA_H = 56;

const PIP_PRESENCE = {
  active: { label: "Active", light: "bg-emerald-500", dark: "bg-emerald-400" },
  available: { label: "Available", light: "bg-sky-500", dark: "bg-sky-400" },
  heads_down: { label: "Heads-down", light: "bg-violet-500", dark: "bg-violet-400" },
  in_meeting: { label: "In a meeting", light: "bg-rose-500", dark: "bg-rose-400" },
  away: { label: "Away", light: "bg-amber-500", dark: "bg-amber-400" },
};

export function cloneDocStyles(targetDoc) {
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    try {
      targetDoc.head.appendChild(node.cloneNode(true));
    } catch {
      /* ignore */
    }
  });
}

function PipAvatar({ participant, dark, isLeader }) {
  const url = participant.avatar_url;
  const initial = (participant.display_name || "?")[0].toUpperCase();
  return (
    <div
      className={`relative rounded-full overflow-hidden border shrink-0 ${
        isLeader
          ? "border-[var(--color-accent)]"
          : dark
            ? "border-slate-700"
            : "border-slate-300"
      }`}
      style={{ width: 28, height: 28 }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span
          className={`flex items-center justify-center w-full h-full text-[11px] font-bold ${
            isLeader
              ? "bg-[var(--color-accent-light-hover)] text-[var(--color-accent)]"
              : dark
                ? "bg-slate-800 text-slate-400"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {initial}
        </span>
      )}
    </div>
  );
}

export function PomodoroConfirmPrompts({
  dark,
  isSynced,
  pendingAction,
  pendingRemoteRow,
  outboundPrompt,
  outboundConfirmLabel,
  onConfirmOutbound,
  onCancelOutbound,
  onConfirmRemote,
  onCancelRemote,
  className = "",
}) {
  if (!pendingAction && !pendingRemoteRow) return null;
  return (
    <div className={`space-y-1.5 ${className}`}>
      {pendingAction && (
        <ConfirmRow
          dark={dark}
          prompt={outboundPrompt}
          confirmLabel={outboundConfirmLabel}
          confirmTone={pendingAction.type === "reset" ? "danger" : "primary"}
          onConfirm={onConfirmOutbound}
          onCancel={onCancelOutbound}
        />
      )}
      {pendingRemoteRow && (
        <ConfirmRow
          dark={dark}
          prompt={
            isSynced
              ? "Someone else updated the timer. Replace your current session?"
              : "Timer state differs on another tab or device. Use that version?"
          }
          confirmLabel="Use updated timer"
          confirmTone="primary"
          onConfirm={onConfirmRemote}
          onCancel={onCancelRemote}
        />
      )}
    </div>
  );
}

export function PipFace({
  mins,
  secs,
  modeLabel,
  dark,
  timeColor,
  startBtnCls,
  startLabel,
  timeSizeClass = "text-5xl",
  isRunning,
  onToggleRun,
  onReset,
  canControl,
  controlsLocked,
  isInTransition,
  onSkipTransition,
  showAlternateBreak,
  alternateBreakLabel,
  onSwitchAlternateBreak,
  confirmProps,
  viewMode,
  onViewModeChange,
  syncSession,
  syncParticipants,
  presenceMap,
  currentUserId,
  onTransferLeader,
  onKickParticipant,
}) {
  const segBtn = (active) =>
    `flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded-md transition-colors ${
      active
        ? dark
          ? "bg-[var(--color-accent)] text-white shadow"
          : "bg-[var(--color-accent)] text-white shadow"
        : dark
          ? "text-slate-300 hover:bg-slate-800"
          : "text-slate-600 hover:bg-slate-100"
    }`;

  const compact = viewMode !== "full";

  return (
    <div
      className={`flex flex-col h-full w-full min-h-0 overflow-hidden ${
        dark ? "bg-slate-900 text-slate-100" : "bg-white text-slate-800"
      }`}
    >
      <div
        className={`shrink-0 flex gap-0.5 p-0.5 m-1 rounded-md ${dark ? "bg-slate-800/60" : "bg-slate-100"}`}
      >
        <button type="button" onClick={() => onViewModeChange("timer")} className={segBtn(viewMode === "timer")}>
          Time
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("controls")}
          className={segBtn(viewMode === "controls")}
        >
          Controls
        </button>
        <button type="button" onClick={() => onViewModeChange("full")} className={segBtn(viewMode === "full")}>
          Users
        </button>
      </div>

      <div
        className={`flex flex-col items-center justify-center gap-0.5 px-2 min-h-0 ${
          compact ? "flex-1" : "shrink-0 py-2"
        }`}
      >
        <span
          className={`${timeSizeClass} font-bold ${timeColor}`}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
            letterSpacing: "0.02em",
          }}
        >
          {mins}:{secs}
        </span>
        <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{modeLabel}</span>
      </div>

      {controlsLocked && confirmProps && (
        <PomodoroConfirmPrompts {...confirmProps} className="shrink-0 px-2 pb-1" />
      )}

      {viewMode !== "timer" && (
        <div className="shrink-0 flex flex-col items-center gap-0.5 pb-1 px-2">
          {isInTransition ? (
            <button
              type="button"
              onClick={onSkipTransition}
              disabled={!canControl || controlsLocked}
              className={`px-4 py-1 rounded-full text-[10px] font-bold text-white shadow-md ${
                !canControl || controlsLocked ? "opacity-40 cursor-default" : ""
              } ${startBtnCls}`}
            >
              Start now
            </button>
          ) : (
            <div className="flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={onReset}
                disabled={!canControl || controlsLocked || isInTransition}
                title="Reset"
                className={`p-1 rounded-full ${
                  !canControl || controlsLocked ? "opacity-30 cursor-default" : ""
                } ${dark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}
                aria-label="Reset"
              >
                ↺
              </button>
              <button
                type="button"
                onClick={onToggleRun}
                disabled={!canControl || controlsLocked || isInTransition}
                className={`px-4 py-1 rounded-full text-[10px] font-bold text-white shadow-md ${
                  !canControl || controlsLocked ? "opacity-40 cursor-default" : ""
                } ${startBtnCls}`}
              >
                {startLabel}
              </button>
            </div>
          )}
          {showAlternateBreak && !isInTransition && (
            <button
              type="button"
              onClick={onSwitchAlternateBreak}
              disabled={!canControl || controlsLocked}
              className={`text-[10px] font-semibold py-0.5 ${
                !canControl || controlsLocked ? "opacity-40 cursor-default" : ""
              } ${dark ? "text-purple-300 hover:text-purple-200" : "text-purple-600 hover:text-purple-700"}`}
            >
              {alternateBreakLabel}
            </button>
          )}
        </div>
      )}

      {viewMode === "full" && syncSession && syncParticipants?.length > 0 && (
        <div
          className={`flex-1 min-h-0 border-t px-2 py-2 overflow-y-auto ${dark ? "border-slate-700" : "border-slate-200"}`}
        >
          <ul className="space-y-1">
            {syncParticipants.map((p) => {
              const isLeader = p.user_id === syncSession.leader_id;
              const isSelf = p.user_id === currentUserId;
              const isOnline = presenceMap?.[p.user_id] ?? false;
              const presence = PIP_PRESENCE[p.presence_state] || PIP_PRESENCE.active;
              const dotCls = isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400";
              const subtitle = p.status?.trim()
                ? p.status
                : `${presence.label}${!isOnline ? " · Offline" : ""}`;
              const canModerate = !isSelf && !isLeader && syncSession.leader_id === currentUserId;
              return (
                <li
                  key={p.user_id}
                  className={`flex items-center gap-2 px-2 h-12 rounded ${dark ? "bg-slate-800/40" : "bg-slate-50"}`}
                >
                  <div className="relative">
                    <PipAvatar participant={p} dark={dark} isLeader={isLeader} />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${
                        dark ? "border-slate-900" : "border-white"
                      } ${dotCls}`}
                      title={presence.label}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}
                    >
                      {isSelf ? `${p.display_name || "You"} (you)` : p.display_name || "Member"}
                      {isLeader && (
                        <span className={`ml-1 ${dark ? "text-amber-300" : "text-amber-500"}`}>★</span>
                      )}
                    </p>
                    <p className={`text-[10px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                      {subtitle}
                    </p>
                  </div>
                  {canModerate && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      {syncSession.leader_id === currentUserId && (
                        <button
                          type="button"
                          onClick={() => onTransferLeader?.(p.user_id)}
                          title="Make leader"
                          className={`text-[11px] w-5 h-5 flex items-center justify-center rounded ${
                            dark
                              ? "text-slate-400 hover:text-[var(--color-accent)] hover:bg-slate-700"
                              : "text-slate-500 hover:text-[var(--color-accent)] hover:bg-slate-200"
                          }`}
                        >
                          ★
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onKickParticipant?.(p.user_id)}
                        title="Remove"
                        className={`text-[11px] w-5 h-5 flex items-center justify-center rounded ${
                          dark
                            ? "text-slate-400 hover:text-red-300 hover:bg-red-500/15"
                            : "text-slate-500 hover:text-red-600 hover:bg-red-50"
                        }`}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
