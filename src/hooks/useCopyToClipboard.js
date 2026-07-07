import { useCallback, useEffect, useRef, useState } from "react";

// Shared clipboard-copy with the "copied!" feedback window every copy
// button reimplemented. `copied` is falsy, or the `key` passed to `copy`
// (default `true`) — pass distinct keys when one component has several
// copy targets and needs to know which one flashed.
export function useCopyToClipboard(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text, key = true) => {
    try {
      await navigator.clipboard.writeText(String(text));
    } catch {
      return false;
    }
    setCopied(key);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), resetMs);
    return true;
  }, [resetMs]);

  return [copied, copy];
}
