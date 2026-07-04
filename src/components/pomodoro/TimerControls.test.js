import { describe, expect, it, vi } from "vitest";
import React from "react";

const pomodoroState = {
  isSynced: false,
  isController: true,
  pendingAction: null,
  canControl: true,
  isRunning: true,
  pendingMode: null,
  mode: "work",
  secondsLeft: 60,
  durations: { work: 1500, shortBreak: 300, longBreak: 900 },
  toggleRun: vi.fn(),
  resetTimer: vi.fn(),
  skipTransition: vi.fn(),
};

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../../pomodoro/PomodoroContext", () => ({
  usePomodoro: () => pomodoroState,
}));

function directChildren(element) {
  return Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children];
}

describe("TimerControls", () => {
  it("does not pass React click events into timer commands", async () => {
    pomodoroState.toggleRun.mockClear();
    pomodoroState.resetTimer.mockClear();
    pomodoroState.skipTransition.mockClear();

    globalThis.React = React;
    const { default: TimerControls } = await import("./TimerControls");
    const element = TimerControls({ size: "sm" });
    const [resetButton, toggleButton] = directChildren(element);
    const fakeClickEvent = { type: "click", target: { id: "pause" } };

    resetButton.props.onClick(fakeClickEvent);
    toggleButton.props.onClick(fakeClickEvent);

    expect(pomodoroState.resetTimer).toHaveBeenCalledWith();
    expect(pomodoroState.toggleRun).toHaveBeenCalledWith();
  });
});
