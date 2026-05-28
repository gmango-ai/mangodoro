import { useDropzone } from "react-dropzone";
import { useTheme } from "../context/ThemeContext";

// Shared uploader UI: dashed-border drop zone with an explicit upload button.
// Used for avatars, custom alarm sounds, and team icons so the experience is
// identical across the app.
//
// Props:
//   accept       — react-dropzone accept object, e.g. { "image/*": [] }
//   maxSize      — max file size in bytes
//   disabled     — disable interaction (also covers `uploading`)
//   uploading    — render the busy state in the button + spinner
//   buttonLabel  — main button text (e.g. "Upload photo" / "Replace sound")
//   uploadingLabel — text shown while a file is uploading
//   hint         — small grey helper text below the button
//   error        — red error message below the hint
//   onFile(file) — called with the accepted file
//   onReject(message) — called when react-dropzone rejects a file
//   children     — preview content (avatar circle, audio info, team icon, etc.)
//   actions      — optional extra action(s) rendered next to the main button
//   variant      — "horizontal" (default) or "vertical"
export default function FileDropZone({
  accept,
  maxSize,
  disabled = false,
  uploading = false,
  buttonLabel = "Upload",
  uploadingLabel = "Uploading…",
  hint,
  error,
  onFile,
  onReject,
  children,
  actions,
  variant = "horizontal",
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept,
    maxFiles: 1,
    maxSize,
    multiple: false,
    disabled: disabled || uploading,
    noClick: true,
    // Force the legacy hidden-input .click() path instead of
    // window.showOpenFilePicker(). The newer File System Access API can
    // hang the renderer when used from inside a portaled modal in an
    // installed PWA (standalone display mode) — our Settings modal and
    // team-settings card both hit this. The hidden-input path uses the
    // same NSOpenPanel under the hood but goes through Blink's older,
    // more battle-tested code path that doesn't have this issue.
    useFsAccessApi: false,
    onDrop: (accepted, rejected) => {
      if (rejected?.[0]?.errors?.[0]) {
        onReject?.(rejected[0].errors[0].message);
        return;
      }
      const f = accepted?.[0];
      if (f) onFile?.(f);
    },
  });

  const layoutCls = variant === "horizontal"
    ? "flex-row items-center"
    : "flex-col items-stretch";
  const stateCls = isDragActive
    ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
    : dark
      ? "border-slate-700 bg-slate-800/30"
      : "border-slate-200 bg-slate-50";

  return (
    <div
      {...getRootProps({
        className: `flex ${layoutCls} gap-3 p-3 rounded-lg border-2 border-dashed transition-colors ${stateCls}`,
      })}
    >
      <input {...getInputProps()} />

      {children && <div className="shrink-0">{children}</div>}

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={open}
            disabled={disabled || uploading}
            className={`inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-md ${
              disabled || uploading ? "opacity-60 cursor-wait" : "cursor-pointer"
            }`}
            style={{
              background: "var(--color-accent-light)",
              color: "var(--color-accent)",
              border: "1px solid var(--color-accent-border)",
            }}
          >
            {uploading ? uploadingLabel : buttonLabel}
          </button>
          {actions}
        </div>
        {hint && (
          <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {hint}
          </p>
        )}
        {error && (
          <p className="text-[12px]" style={{ color: "#dc2626" }}>{error}</p>
        )}
      </div>
    </div>
  );
}
