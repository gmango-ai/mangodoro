import { useTheme } from "../context/ThemeContext";

// Base pulse block. Pass `className` for sizing (h-3, w-24, etc.) or use
// the shorthand wrappers below. Stays subtle in both themes so it reads
// as "loading" rather than "broken empty card".
export function Skeleton({ className = "", style }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return (
    <div
      style={style}
      className={`animate-pulse rounded ${
        dark ? "bg-slate-800/60" : "bg-slate-200/70"
      } ${className}`}
    />
  );
}

// One or more lines of "text". Last line is shorter so it reads like a
// paragraph rather than a paste-up of rectangles.
export function SkeletonText({ lines = 1, className = "" }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 && lines > 1 ? "w-3/5" : "w-full"}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCircle({ size = 32, className = "" }) {
  return (
    <Skeleton
      className={`rounded-full ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

// Themed card frame around skeleton children — matches the visual weight
// of the real cards on each page so the layout doesn't shift when data
// arrives.
export function SkeletonCard({ children, className = "" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return (
    <div
      className={`rounded-2xl border p-4 ${
        dark
          ? "bg-slate-900/60 border-slate-700/50"
          : "bg-white border-slate-200"
      } ${className}`}
    >
      {children}
    </div>
  );
}
