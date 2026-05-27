import { useId, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { uploadAvatar } from "../lib/avatar";
import { Camera, Loader2, X } from "lucide-react";

// Triggers the OS file picker via a native <label htmlFor> instead of
// inputRef.current.click(). Programmatic .click() on a file input inside a
// portal modal can deadlock the renderer when password manager extensions
// (1Password / LastPass / Bitwarden) hook click events. The native label
// path bypasses those hooks entirely.
export default function AvatarUploader({
  userId,
  value,
  displayName = "",
  size = 64,
  onChange,
  onError,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const inputId = useId();
  const [uploading, setUploading] = useState(false);

  const initial = (displayName || "?")[0].toUpperCase();

  async function handlePick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    const { data, error } = await uploadAvatar(file, userId);
    setUploading(false);
    if (error) {
      onError?.(error.message || "Upload failed");
      return;
    }
    onChange?.(data.url);
  }

  function handleClear(e) {
    e.stopPropagation();
    e.preventDefault();
    onChange?.("");
  }

  const px = `${size}px`;
  const fontSize = Math.max(14, Math.round(size / 2.5));

  return (
    <div className="flex items-center gap-3">
      {/* Hidden input — kept outside the label/button tree so it's not
          double-triggered. Extensions can still hook it, but since we
          activate it via the native label/htmlFor pairing they get no
          synthetic click event to intercept. */}
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handlePick}
        disabled={uploading}
        className="sr-only"
      />

      <label
        htmlFor={inputId}
        aria-disabled={uploading}
        title="Upload profile picture"
        className={`relative rounded-full overflow-hidden border-2 transition-colors cursor-pointer ${
          uploading ? "opacity-80 cursor-wait" : ""
        } ${
          dark
            ? "border-slate-700 hover:border-cyan-500/60 bg-slate-800"
            : "border-slate-200 hover:border-teal-400 bg-slate-100"
        }`}
        style={{ width: px, height: px }}
      >
        {value ? (
          <img src={value} alt="" className="w-full h-full object-cover" />
        ) : (
          <span
            className={`flex items-center justify-center w-full h-full font-bold ${
              dark ? "text-slate-400" : "text-slate-500"
            }`}
            style={{ fontSize }}
          >
            {initial}
          </span>
        )}
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity ${
            uploading ? "opacity-100" : "opacity-0 hover:opacity-100"
          } bg-black/50`}
        >
          {uploading ? (
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          ) : (
            <Camera className="w-5 h-5 text-white" />
          )}
        </span>
      </label>

      <div className="flex flex-col gap-1 text-xs">
        <label
          htmlFor={inputId}
          aria-disabled={uploading}
          className={`cursor-pointer text-left font-semibold ${
            uploading ? "opacity-60 cursor-wait" : ""
          } ${
            dark ? "text-cyan-400 hover:text-cyan-300" : "text-teal-700 hover:text-teal-600"
          }`}
        >
          {value ? "Change photo" : "Upload photo"}
        </label>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className={`text-left ${
              dark ? "text-slate-500 hover:text-red-300" : "text-slate-400 hover:text-red-500"
            }`}
          >
            <X className="w-3 h-3 inline" /> Remove
          </button>
        )}
        <span className={dark ? "text-slate-500" : "text-slate-400"}>
          JPG / PNG / WebP · max 2 MB
        </span>
      </div>
    </div>
  );
}
