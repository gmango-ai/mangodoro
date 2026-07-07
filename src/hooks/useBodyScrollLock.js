import { useEffect } from "react";

const TOUCH =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

// Locks page scrolling while a full-viewport "app" page is mounted (Messages,
// Office, the whiteboard editor). These pages size themselves to exactly
// 100dvh − nav − insets, but the AppLayout wrapper is min-h-screen and the
// body carries a bottom-inset padding for scrolling pages — together those add
// a sliver of page scroll that pushes the bottom row (composer, controls) under
// the fixed bottom nav. Pinning the body removes that outer scroll so the
// page's own inner scroll areas behave. iOS still document-pans with plain
// overflow:hidden, so on touch we also position:fixed the body.
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overscroll: body.style.overscrollBehavior,
    };
    const scrollY = window.scrollY;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    if (TOUCH) {
      window.scrollTo(0, 0);
      body.style.position = "fixed";
      body.style.top = "0";
      body.style.width = "100%";
    }
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.overflow;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overscrollBehavior = prev.overscroll;
      if (TOUCH) window.scrollTo(0, scrollY);
    };
  }, [active]);
}
