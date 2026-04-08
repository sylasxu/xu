import { describe, expect, test } from 'bun:test';
import {
  buildPartnerWorkflowIntroText,
  createPartnerMatchingState,
  getNextQuestion,
} from './partner-matching';

describe('partner matching scenario-aware prompts', () => {
  test('treats destination companion as the same flow without forcing local activity-type followup', () => {
    const state = createPartnerMatchingState('泸州音乐节有人去吗');

    expect(state.scenarioType).toBe('destination_companion');
    expect(state.collectedPreferences.location).toBe('泸州');
    expect(state.missingRequired).toEqual([]);

    const intro = buildPartnerWorkflowIntroText(state);
    expect(intro).toContain('一起去泸州');
    expect(getNextQuestion(state)).toBeNull();
  });

  test('keeps fill-seat phrasing in the same partner flow with seat-fill intro', () => {
    const state = createPartnerMatchingState('周六晚上差一个麻将搭子，在观音桥');

    expect(state.scenarioType).toBe('fill_seat');
    expect(state.collectedPreferences.activityType).toBe('boardgame');
    expect(state.collectedPreferences.location).toBe('观音桥');

    const intro = buildPartnerWorkflowIntroText(state);
    expect(intro).toContain('临时补位');
  });
});
