import { describe, expect, it } from 'bun:test';

import { understandPartnerRequest } from './partner-understanding';

describe('understandPartnerRequest', () => {
  it('understands destination companion requests for festival scenes', () => {
    const result = understandPartnerRequest('泸州音乐节有人去吗');

    expect(result.scenarioType).toBe('destination_companion');
    expect(result.intentStyle).toBe('companion_trip');
    expect(result.activityType).toBe('event');
    expect(result.destinationText).toBe('泸州');
    expect(result.activityText).toBe('音乐节');
  });

  it('keeps non-standard weekend phrasing like 周6 and extracts destination text', () => {
    const result = understandPartnerRequest('周6平顶山有没有人');

    expect(result.scenarioType).toBe('destination_companion');
    expect(result.destinationText).toBe('平顶山');
    expect(result.timeText).toBe('周6');
    expect(result.normalizedTimeRange).toBe('weekend');
  });

  it('treats passive join phrasing as the same partner flow', () => {
    const result = understandPartnerRequest('谁组我就去，周五下班想找个饭搭子');

    expect(result.scenarioType).toBe('local_partner');
    expect(result.intentStyle).toBe('passive_join');
    expect(result.activityType).toBe('food');
    expect(result.timeText).toBe('周五');
  });

  it('detects fill-seat phrasing without forcing a new product branch', () => {
    const result = understandPartnerRequest('周六晚上差一个麻将搭子，在观音桥');

    expect(result.scenarioType).toBe('fill_seat');
    expect(result.intentStyle).toBe('seat_fill');
    expect(result.activityType).toBe('boardgame');
    expect(result.locationText).toBe('观音桥');
    expect(result.normalizedTimeRange).toBe('weekend');
  });

  it('preserves local partner scenes while broadening free-text understanding', () => {
    const result = understandPartnerRequest('周五观音桥饭搭子，AA，想找安静一点的');

    expect(result.scenarioType).toBe('local_partner');
    expect(result.activityType).toBe('food');
    expect(result.locationText).toBe('观音桥');
    expect(result.constraints).toContain('AA');
    expect(result.constraints).toContain('Quiet');
  });
});
