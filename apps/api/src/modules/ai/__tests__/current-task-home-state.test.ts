import { describe, expect, it } from 'bun:test';
import type { CurrentAgentTaskSnapshot } from '../task-runtime/agent-task.service';
import { resolveCurrentTaskHomeState } from '../task-runtime/agent-task.service';

function buildTaskSnapshot(
  overrides: Partial<CurrentAgentTaskSnapshot> & Pick<CurrentAgentTaskSnapshot, 'id' | 'currentStage' | 'status'>,
): CurrentAgentTaskSnapshot {
  return {
    id: overrides.id,
    taskType: overrides.taskType ?? 'join_activity',
    taskTypeLabel: overrides.taskTypeLabel ?? '报名活动',
    currentStage: overrides.currentStage,
    stageLabel: overrides.stageLabel ?? overrides.currentStage,
    status: overrides.status,
    goalText: overrides.goalText ?? '继续处理这件事',
    headline: overrides.headline ?? '正在推进一件事',
    summary: overrides.summary ?? '测试摘要',
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    ...(overrides.activityId ? { activityId: overrides.activityId } : {}),
    ...(overrides.activityTitle ? { activityTitle: overrides.activityTitle } : {}),
    ...(overrides.attentionLevel ? { attentionLevel: overrides.attentionLevel } : {}),
    ...(overrides.primaryAction ? { primaryAction: overrides.primaryAction } : {}),
    ...(overrides.secondaryAction ? { secondaryAction: overrides.secondaryAction } : {}),
  };
}

describe('resolveCurrentTaskHomeState', () => {
  it('returns H0 when there are no current tasks', () => {
    expect(resolveCurrentTaskHomeState([])).toEqual({
      homeState: 'H0',
      primaryTaskId: null,
    });
  });

  it('prioritizes match_ready as H3 over other active tasks', () => {
    const result = resolveCurrentTaskHomeState([
      buildTaskSnapshot({ id: 'task-active', currentStage: 'discussion', status: 'active' }),
      buildTaskSnapshot({ id: 'task-match', currentStage: 'match_ready', status: 'waiting_async_result', taskType: 'find_partner' }),
    ]);

    expect(result).toEqual({
      homeState: 'H3',
      primaryTaskId: 'task-match',
    });
  });

  it('treats time-sensitive join work as H3', () => {
    const result = resolveCurrentTaskHomeState([
      buildTaskSnapshot({ id: 'task-active', currentStage: 'draft_ready', status: 'active', taskType: 'create_activity' }),
      buildTaskSnapshot({
        id: 'task-soon',
        currentStage: 'discussion',
        status: 'active',
        attentionLevel: 'time_sensitive',
      }),
    ]);

    expect(result).toEqual({
      homeState: 'H3',
      primaryTaskId: 'task-soon',
    });
  });

  it('treats action-required work as H3', () => {
    const result = resolveCurrentTaskHomeState([
      buildTaskSnapshot({ id: 'task-active', currentStage: 'discussion', status: 'active' }),
      buildTaskSnapshot({
        id: 'task-action-required',
        currentStage: 'published',
        status: 'active',
        attentionLevel: 'action_required',
        taskType: 'create_activity',
      }),
    ]);

    expect(result).toEqual({
      homeState: 'H3',
      primaryTaskId: 'task-action-required',
    });
  });

  it('keeps active in-progress work ahead of waiting_auth', () => {
    const result = resolveCurrentTaskHomeState([
      buildTaskSnapshot({ id: 'task-auth', currentStage: 'auth_gate', status: 'waiting_auth' }),
      buildTaskSnapshot({ id: 'task-active', currentStage: 'draft_ready', status: 'active', taskType: 'create_activity' }),
    ]);

    expect(result).toEqual({
      homeState: 'H2',
      primaryTaskId: 'task-active',
    });
  });

  it('keeps waiting_auth ahead of post_activity when no active work is stronger', () => {
    const result = resolveCurrentTaskHomeState([
      buildTaskSnapshot({ id: 'task-post', currentStage: 'post_activity', status: 'waiting_async_result' }),
      buildTaskSnapshot({ id: 'task-auth', currentStage: 'auth_gate', status: 'waiting_auth' }),
    ]);

    expect(result).toEqual({
      homeState: 'H1',
      primaryTaskId: 'task-auth',
    });
  });

  it('falls back to post_activity as H4 when no higher-priority task exists', () => {
    const result = resolveCurrentTaskHomeState([
      buildTaskSnapshot({ id: 'task-post', currentStage: 'post_activity', status: 'waiting_async_result' }),
    ]);

    expect(result).toEqual({
      homeState: 'H4',
      primaryTaskId: 'task-post',
    });
  });
});
