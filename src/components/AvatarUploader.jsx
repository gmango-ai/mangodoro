import { useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { uploadAvatar } from "../lib/avatar";
import { X } from "lucide-react";
import FileDropZone from "./FileDropZone";

const MAX_BYTES = 2 * 1024 * 1024;

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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const initial = (displayName || "?")[0].toUpperCase();

  async function processFile(file) {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const { data, error: err } = await uploadAvatar(file, userId);
      if (err) {
        const msg = err.message || "Upload failed";
        setError(msg);
        onError?.(msg);
        return;
      }
      onChange?.(data.url);
    } catch (err) {
      const msg = err?.message || "Upload failed";
      setError(msg);
      onError?.(msg);
    } finally {
      setUploading(false);
    }
  }

  function handleReject(msg) {
    setError(msg);
    onError?.(msg);
  }

  function handleClear() {
    onChange?.("");
  }

  const px = `${size}px`;
  const fontSize = Math.max(14, Math.round(size / 2.5));

  return (
    <FileDropZone
      accept={{ "image/*": [] }}
      maxSize={MAX_BYTES}
      uploading={uploading}
      buttonLabel={value ? "Change photo" : "Upload photo"}
      hint="Click or drop an image · max 2 MB"
      error={error}
      onFile={processFile}
      onReject={handleReject}
      actions={value ? (
        <button
          type="button"
          onClick={handleClear}
          className={`text-[11px] font-medium px-2 py-1 rounded ${
            dark ? "text-slate-500 hover:text-red-300" : "text-slate-500 hover:text-red-500"
          }`}
        >
          <X className="w-3 h-3 inline" /> Remove
        </button>
      ) : null}
    >
      <div
        className={`relative rounded-full overflow-hidden border-2 ${
          dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-100"
        }`}
        style={{ width: px, height: px }}
      >
        {value ? (
          <img src={value} alt="" className="w-full h-full object-cover" draggable={false} />
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
      </div>
    </FileDropZone>
  );
}
