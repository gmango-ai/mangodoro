import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// Tag the document so CSS can target Electron-only chrome (the
// hiddenInset / titleBarOverlay window styles need a top inset so the
// traffic-light controls don't overlap renderer content). We key off
// the preload-exposed bridge for the same reason platform.js does —
// the bridge being present is the actual capability we care about.
if (typeof window !== "undefined" && window.__electronTimer) {
  document.documentElement.classList.add("electron");
}

// Hard split between the main app and the menubar popover. The popover
// BrowserWindow loads `?ui=popover`; we render an entirely different
// React tree there (no router, no Nav, no FAB) so electron-serve's
// path normalisation can't accidentally route the popover into the
// full app's PomodoroPage. The class is also used by index.css to
// override the accent body background with a neutral one.
const isPopover =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("ui") === "popover";
if (isPopover) {
  document.documentElement.classList.add("electron-popover");
}

async function bootstrap() {
  if (isPopover) {
    const { default: PopoverEntry } = await import("./popover/PopoverEntry");
    createRoot(document.getElementById("root")).render(
      <StrictMode>
        <PopoverEntry />
      </StrictMode>
    );
    return;
  }
  const { default: App } = await import("./App");
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap();
