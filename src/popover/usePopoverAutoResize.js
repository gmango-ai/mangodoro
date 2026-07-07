import { useEffect } from "react";

// Live-resize the Electron popover BrowserWindow to fit the container's
// content as it reflows. No-op outside the popover (no bridge) — shared by
// QuickActionsPopover and the signed-out PopoverLocalTimer.
export function usePopoverAutoResize(containerRef) {
  useEffect(() => {
    const bridge = window.__electronPopover;
    if (!bridge?.resize) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const h = Math.ceil(entries[0].contentRect.height);
      if (h > 0) bridge.resize(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);
}
