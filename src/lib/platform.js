import { Capacitor } from "@capacitor/core";

// Production web origin. Used for share links and as the OAuth redirect
// base when running inside Capacitor — capacitor://localhost is useless
// to share or to register with an OAuth provider.
const PRODUCTION_WEB_URL = "https://mangodoro.com";

// Custom URL scheme for deep links back into the native app (auth
// callbacks, future invite links). Must match the scheme registered in
// ios/App/App/Info.plist and android/app/src/main/AndroidManifest.xml.
const NATIVE_URL_SCHEME = "mangodoro";

export const isMobileApp = Capacitor.isNativePlatform();

export function getPlatform() {
  return Capacitor.getPlatform(); // "ios" | "android" | "web"
}

export function getNativeUrlScheme() {
  return NATIVE_URL_SCHEME;
}

// Where Supabase / OAuth should redirect after sign-in. On native this
// is a custom scheme; the registered deep-link handler picks up the
// session code and hands it to supabase.auth.exchangeCodeForSession.
// On web we preserve the full current URL so deep-link routes like
// /team/join/:code survive the OAuth round-trip.
export const NATIVE_AUTH_CALLBACK = `${NATIVE_URL_SCHEME}://auth/callback`;

export function getAuthRedirectUrl() {
  if (isMobileApp) return NATIVE_AUTH_CALLBACK;
  return window.location.href;
}

// Used for email-confirmation links. Native app users tap the link from
// whatever device opens their inbox, so we point at the production web
// URL — once a user has confirmed, they sign in to the mobile app
// directly with the same credentials.
export function getEmailRedirectUrl() {
  if (isMobileApp) return PRODUCTION_WEB_URL;
  return window.location.origin;
}

// Base URL used to build shareable links (sync session invites, team
// join URLs, retro invites). On native we point at the production web
// app since recipients can't open capacitor://localhost.
export function getShareableBaseUrl() {
  if (isMobileApp) return PRODUCTION_WEB_URL;
  return window.location.origin;
}
