// Thin PostHog wrapper. Everything is a no-op when VITE_POSTHOG_KEY is
// absent, so local dev / unconfigured builds carry no analytics weight
// and nothing throws.
//
// Used primarily to measure the Jitsi ↔ LiveKit video A/B: each call
// emits attempt / connected / failed / ended events tagged with the
// provider + platform, so PostHog can compare connect-success and
// session length per provider × mobile-vs-desktop.

import posthog from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY || "";
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let enabled = false;

export function initAnalytics() {
  if (enabled || !KEY || typeof window === "undefined") return;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only",
  });
  enabled = true;
}

export function identifyUser(userId, props) {
  if (!enabled || !userId) return;
  try { posthog.identify(userId, props); } catch { /* */ }
}

export function track(event, props) {
  if (!enabled) return;
  try { posthog.capture(event, props); } catch { /* */ }
}

export function resetAnalytics() {
  if (!enabled) return;
  try { posthog.reset(); } catch { /* */ }
}

// Best-effort mobile detection for splitting the A/B by platform — the
// whole reason for the experiment is mobile call quality.
export function isMobileClient() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return true;
  // iPadOS 13+ masquerades as desktop Safari but reports touch points.
  if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)) return true;
  return false;
}
