export type RuntimeTaskFocusSnapshot = {
  id: string;
  activityId?: string;
};

export type WelcomeFocusIdentity = {
  taskId?: string;
  activityId?: string;
};

export function isWelcomeFocusCoveredByCurrentTasks(
  focus: WelcomeFocusIdentity | null,
  tasks: RuntimeTaskFocusSnapshot[]
): boolean {
  if (!focus || tasks.length === 0) {
    return false;
  }

  return tasks.some((task) => {
    if (focus.taskId && task.id === focus.taskId) {
      return true;
    }

    if (focus.activityId && task.activityId === focus.activityId) {
      return true;
    }

    return false;
  });
}
