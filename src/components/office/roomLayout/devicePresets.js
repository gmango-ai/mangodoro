import { leaf, split } from "./layoutTree";

// Starting layouts for the kiosk (device) — the counterpart to presets.js for
// members. Uses the device panel ids (see devicePanels.jsx). Fed to the shared
// useRoomLayout via opts so the kiosk's arrangeable layout is the same engine the
// member room uses, just with the communal-display defaults.
export const DEVICE_PRESETS = [
  { id: "videoTimer", label: "Video + Timer", tree: () => split("row", leaf("video"), leaf("timer"), 0.64) },
  { id: "videoChat", label: "Video + Chat", tree: () => split("row", leaf("video"), leaf("chat"), 0.68) },
  { id: "video", label: "Video only", tree: () => leaf("video") },
  { id: "timer", label: "Timer only", tree: () => leaf("timer") },
  {
    id: "conference",
    label: "Video + Timer + Who's here",
    tree: () => split("row", leaf("video"), split("col", leaf("timer"), leaf("presence"), 0.6), 0.62),
  },
  { id: "board", label: "Whiteboard + Video", tree: () => split("row", leaf("whiteboard"), leaf("video"), 0.64) },
];

export const DEVICE_DEFAULT_PRESET = "videoTimer";
