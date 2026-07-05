// Multi-tab notification consolidation — decide which surfaces THIS tab shows
// for an incoming delivery. Pure, so it's unit-tested; the side-effects (Web
// Locks leadership, visibility) are read by the caller and passed in.
//
// The problem: every open tab independently subscribes to notification_deliveries
// realtime, so without coordination N tabs stack N toasts and N OS banners for
// one event. We split the surfaces by what each is FOR:
//   • toast + its sound → only the tab you're LOOKING at (visible). A toast on a
//     hidden tab is invisible anyway, and this stops N tabs stacking N toasts.
//   • OS notification    → only the elected LEADER tab (one per browser via the
//     Web Locks lock), so N tabs produce exactly one banner — not relying on the
//     OS tag-collapse coincidence.
// The bell badge / inbox stay per-tab (each derives its own count), so every tab
// still reflects the notification.

export function notificationSurfaces({
  channels = [],
  action,             // deliveryAction(priority, availability) → { sound, push, … }
  wantsDesktop,       // the type routes to the desktop channel
  isLeader,           // this tab holds the notif-leader lock
  isVisible,          // document.visibilityState === "visible"
  permissionGranted,  // Notification.permission === "granted"
  quietHours,         // within the user's quiet-hours window
} = {}) {
  const inapp = channels.includes("inapp");
  const toast = inapp && !!isVisible;
  const sound = toast && !!action?.sound;
  const os =
    !!action?.push && !!wantsDesktop && !!isLeader && !!permissionGranted && !quietHours;
  return { toast, sound, os };
}
