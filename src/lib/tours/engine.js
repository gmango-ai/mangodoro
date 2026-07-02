import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "../../styles/tour.css";

// DOM + driver.js orchestration. Pure logic (prerequisites, announcements,
// checklist) lives in ./logic.js; this module is not unit-tested (the test env
// is node/no-DOM) — it's exercised in the browser and via the manual QA script.

// Resolve a selector (string or () => Element) to a live element, waiting for it
// to appear. Routes are lazy (Suspense) and menus mount on click, so a target
// often isn't in the DOM the instant we want to highlight it. Resolves the
// element, or null on timeout so callers can skip/abort gracefully.
export function waitForElement(selector, { timeout = 4000, root = null } = {}) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope) return Promise.resolve(null);
  const find = () => {
    try {
      return typeof selector === "function" ? selector() : scope.querySelector(selector);
    } catch {
      return null;
    }
  };
  return new Promise((resolve) => {
    const first = find();
    if (first) return resolve(first);
    let done = false;
    const finish = (el) => {
      if (done) return;
      done = true;
      try { obs.disconnect(); } catch { /* */ }
      clearInterval(iv);
      clearTimeout(to);
      resolve(el);
    };
    const target = scope.body || scope.documentElement || scope;
    const obs = new MutationObserver(() => { const el = find(); if (el) finish(el); });
    try { obs.observe(target, { childList: true, subtree: true }); } catch { /* */ }
    // Interval backstop for changes a MutationObserver can miss (e.g. attribute
    // flips on an already-present node, or observing before body exists).
    const iv = setInterval(() => { const el = find(); if (el) finish(el); }, 150);
    const to = setTimeout(() => finish(null), timeout);
  });
}

const BASE_CONFIG = {
  showProgress: true,
  allowClose: true,
  overlayColor: "rgba(2, 6, 23, 0.72)",
  stagePadding: 6,
  stageRadius: 10,
  popoverClass: "mango-tour",
  nextBtnText: "Next",
  prevBtnText: "Back",
  doneBtnText: "Done",
};

// Run a full tour. Assumes the caller (TourContext.startTour) has already run
// `entry` navigation. Returns the driver instance.
//   ctx           — live app snapshot incl. `waitFor` (bound waitForElement)
//   onComplete()  — user reached the end ("Done")
//   onDismiss()   — user closed early (X / overlay / Esc)
export function runTour(tour, ctx, { onComplete, onDismiss } = {}) {
  // Evaluate optional per-step `when(ctx)` once at start; skipped steps drop out.
  const steps = (tour.steps || [])
    .filter((s) => typeof s.when !== "function" || s.when(ctx))
    .map((s) => ({
      element: s.element,
      popover: {
        title: s.popover?.title,
        description: s.popover?.description,
        side: s.popover?.side || "bottom",
        align: s.popover?.align || "start",
      },
      _step: s,
    }));

  if (!steps.length) { onDismiss?.(); return null; }

  let finishedNaturally = false;

  const advance = async (d) => {
    const idx = d.getActiveIndex();
    const cur = steps[idx]?._step;
    // Run the current step's side-effect (navigate / open a menu / open a modal)
    // BEFORE the next step tries to highlight its target.
    try { if (cur?.onNext) await cur.onNext(ctx); } catch { /* keep going */ }
    if (idx >= steps.length - 1) {
      finishedNaturally = true;
      d.destroy();
      return;
    }
    const next = steps[idx + 1];
    if (next?.element && typeof next.element !== "function") {
      await ctx.waitFor(next.element);
    }
    d.moveNext();
  };

  const d = driver({
    ...BASE_CONFIG,
    steps,
    onNextClick: () => { advance(d); },
    onPrevClick: () => { d.movePrevious(); },
    onCloseClick: () => { d.destroy(); },
    onDestroyed: () => { (finishedNaturally ? onComplete : onDismiss)?.(); },
  });

  // Ensure step 0's target exists, then start.
  (async () => {
    const first = steps[0];
    if (first?.element && typeof first.element !== "function") {
      await ctx.waitFor(first.element);
    }
    d.drive();
  })();

  return d;
}

// A single explanatory popover on a control the user must act on first (used
// when a tour's prerequisite isn't met — e.g. "create or join an org first").
// Points at `selector` if present, otherwise shows a centered message.
export async function showRemedy(selector, { title, description }, ctx) {
  const el = selector ? await (ctx?.waitFor ? ctx.waitFor(selector) : waitForElement(selector)) : null;
  const d = driver({ ...BASE_CONFIG, showProgress: false, doneBtnText: "Got it" });
  d.highlight({
    element: el || undefined,
    popover: { title, description, side: "bottom", align: "start" },
  });
  return d;
}
