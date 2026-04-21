import { describe, expect, test } from "bun:test";

import {
  isWelcomeFocusCoveredByCurrentTasks,
  type RuntimeTaskFocusSnapshot,
  type WelcomeFocusIdentity,
} from "./runtime-task-focus";

describe("isWelcomeFocusCoveredByCurrentTasks", () => {
  const tasks: RuntimeTaskFocusSnapshot[] = [
    { id: "task-1", activityId: "activity-1" },
    { id: "task-2", activityId: "activity-2" },
  ];

  test("returns true when welcome focus points to the same task", () => {
    const focus: WelcomeFocusIdentity = {
      taskId: "task-1",
      activityId: "activity-3",
    };

    expect(isWelcomeFocusCoveredByCurrentTasks(focus, tasks)).toBe(true);
  });

  test("returns true when welcome focus points to the same activity", () => {
    const focus: WelcomeFocusIdentity = {
      activityId: "activity-2",
    };

    expect(isWelcomeFocusCoveredByCurrentTasks(focus, tasks)).toBe(true);
  });

  test("returns false when focus points to a different task and activity", () => {
    const focus: WelcomeFocusIdentity = {
      taskId: "task-3",
      activityId: "activity-3",
    };

    expect(isWelcomeFocusCoveredByCurrentTasks(focus, tasks)).toBe(false);
  });

  test("returns false when focus is missing", () => {
    expect(isWelcomeFocusCoveredByCurrentTasks(null, tasks)).toBe(false);
  });
});
