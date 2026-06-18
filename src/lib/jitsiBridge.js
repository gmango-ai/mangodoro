// Tiny module-level bridge so widgets outside <VideoCall /> (e.g. the
// TimerWidget's "Share music" button) can reach into the live Jitsi
// External API instance to fire commands like toggleShareScreen.
//
// We avoid threading the api ref through React context because:
//   1. Only one Jitsi instance can be active at a time anyway.
//   2. Most consumers fire one-shot commands and don't need to
//      re-render on every Jitsi event — a ref + subscribe model is a
//      better fit than context.
//
// VideoCall calls register(api) once the iframe is constructed and
// unregister() on dispose. Anyone else uses getJitsiApi() at click
// time and subscribe(listener) if they want to react to lifecycle
// changes (e.g. "video call ended → hide the Share music button").

let _api = null;
const listeners = new Set();

export function registerJitsiApi(api) {
  _api = api;
  for (const fn of listeners) fn(_api);
}

export function unregisterJitsiApi() {
  _api = null;
  for (const fn of listeners) fn(null);
}

export function getJitsiApi() {
  return _api;
}

export function subscribeJitsiApi(fn) {
  listeners.add(fn);
  fn(_api);
  return () => listeners.delete(fn);
}
