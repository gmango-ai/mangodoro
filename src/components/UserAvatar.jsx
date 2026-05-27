export default function UserAvatar({ url, name = "", size = 28, className = "" }) {
  const initial = (name || "?")[0].toUpperCase();
  const px = `${size}px`;
  const fontSize = Math.max(10, Math.round(size / 2.5));

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={`rounded-full object-cover ${className}`}
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 ${className}`}
      style={{ width: px, height: px, fontSize }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
