import { PomodoroEngine } from "./PomodoroEngine.js";

let engineInstance = null;
let engineUserId = null;

export function getEngine(userId) {
  if (!userId) return null;
  if (engineInstance && engineUserId !== userId) {
    engineInstance.destroy();
    engineInstance = null;
    engineUserId = null;
  }
  if (!engineInstance) {
    engineInstance = new PomodoroEngine(userId);
    engineUserId = userId;
  }
  return engineInstance;
}

export function destroyEngine() {
  engineInstance?.destroy();
  engineInstance = null;
  engineUserId = null;
}
