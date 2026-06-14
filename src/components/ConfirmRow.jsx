export default function ConfirmRow({ dark, prompt, confirmLabel, confirmTone, onConfirm, onCancel }) {
  const confirmCls =
    confirmTone === "danger"
      ? dark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-600 hover:bg-red-500 text-white"
      : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white";
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
            dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
