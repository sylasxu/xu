export type PartnerScenarioType = 'local_partner' | 'destination_companion' | 'fill_seat';

export type PartnerIntentStyle = 'passive_join' | 'active_invite' | 'companion_trip' | 'seat_fill';

export type PartnerSemanticType =
  | 'food'
  | 'sports'
  | 'boardgame'
  | 'entertainment'
  | 'event'
  | 'travel'
  | 'other';

export type PartnerNormalizedTimeRange =
  | 'tonight'
  | 'tomorrow'
  | 'weekend'
  | 'next_week';

export interface PartnerUnderstanding {
  scenarioType: PartnerScenarioType;
  intentStyle: PartnerIntentStyle;
  activityType: PartnerSemanticType;
  activityText?: string;
  locationText?: string;
  destinationText?: string;
  timeText?: string;
  normalizedTimeRange?: PartnerNormalizedTimeRange;
  constraints: string[];
  confidence: number;
  needsFollowup: string[];
}

const EVENT_PATTERN = /(音乐节|演唱会|音乐会|演出|livehouse|漫展|展览|看展|展子)/i;
const TRAVEL_PATTERN = /(旅行|旅游|自驾|露营|徒步|爬山|出发|同去|同行|一起去)/;
const BOARDGAME_PATTERN = /(麻将|桌游|狼人杀|剧本杀|三缺一|补位)/;
const FOOD_PATTERN = /(火锅|烧烤|吃饭|约饭|咖啡|奶茶|夜宵|饭搭子)/;
const SPORTS_PATTERN = /(羽毛球|篮球|跑步|徒步|运动|打球|游泳|骑行|网球)/;
const ENTERTAINMENT_PATTERN = /(唱歌|KTV|电影|酒吧|清吧|livehouse)/i;

const FILL_SEAT_PATTERN = /(差一|差个|缺一|缺个|补位|补一个|三缺一|四缺一)/;
const PASSIVE_JOIN_PATTERN = /(谁组我就去|有人吗|有人去吗|有没有人|能带一个吗|求带|求捞)/;
const COMPANION_TRIP_PATTERN = /(同去|同行|一起去|一路|顺路|搭子一起去)/;
const DESTINATION_QUESTION_PATTERN = /(有人吗|有人去吗|有没有人)/;

const WEEKEND_PATTERN = /(周末|周六|周日|周6|周7|星期六|星期天|星期日|礼拜六|礼拜天)/;
const TOMORROW_PATTERN = /(明天|明晚)/;
const TONIGHT_PATTERN = /(今晚|今晚上|今天晚上|今晚下班)/;
const NEXT_WEEK_PATTERN = /(下周|下下周)/;
const TIME_TEXT_PATTERN = /(今晚|今晚上|今天晚上|明天|明晚|周末|周六|周日|周6|周7|星期[一二三四五六日天]|礼拜[一二三四五六天]|下周|下下周|本周末|周[一二三四五六日天])/;

const CONSTRAINT_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /(^|\b)aa(制)?(\b|$)/i, value: 'AA' },
  { pattern: /(不喝酒)/, value: 'NoAlcohol' },
  { pattern: /(安静|别太闹|清净)/, value: 'Quiet' },
  { pattern: /(女生友好|女孩子友好)/, value: 'WomenFriendly' },
];

function trimPartnerText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractConstraintTags(input: string): string[] {
  const tags: string[] = [];

  for (const item of CONSTRAINT_PATTERNS) {
    if (item.pattern.test(input)) {
      tags.push(item.value);
    }
  }

  return Array.from(new Set(tags));
}

function inferPartnerSemanticType(input: string): PartnerSemanticType {
  if (BOARDGAME_PATTERN.test(input)) return 'boardgame';
  if (FOOD_PATTERN.test(input)) return 'food';
  if (SPORTS_PATTERN.test(input)) return 'sports';
  if (EVENT_PATTERN.test(input)) return 'event';
  if (TRAVEL_PATTERN.test(input)) return 'travel';
  if (ENTERTAINMENT_PATTERN.test(input)) return 'entertainment';
  return 'other';
}

function extractTimeText(input: string): string | undefined {
  const matched = input.match(TIME_TEXT_PATTERN);
  return matched?.[0];
}

function normalizePartnerTimeRange(input: string): PartnerNormalizedTimeRange | undefined {
  if (TONIGHT_PATTERN.test(input)) return 'tonight';
  if (TOMORROW_PATTERN.test(input)) return 'tomorrow';
  if (WEEKEND_PATTERN.test(input)) return 'weekend';
  if (NEXT_WEEK_PATTERN.test(input)) return 'next_week';
  return undefined;
}

function extractEventDestination(input: string): { destinationText?: string; activityText?: string } {
  const matched = input.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,16})(音乐节|演唱会|音乐会|演出|livehouse|漫展|展览|看展|展子)/i);
  if (!matched) {
    return {};
  }

  const [, prefix, suffix] = matched;
  return {
    destinationText: trimPartnerText(prefix),
    activityText: trimPartnerText(suffix),
  };
}

function extractDestinationPlace(input: string): string | undefined {
  const explicitTarget = input.match(
    /(?:去|到|在|冲|飞|约)([\u4e00-\u9fa5A-Za-z]{2,20})(?:有没有人|有人吗|有人去吗|一起去|同去|同行)?/
  );
  if (explicitTarget?.[1]) {
    return trimPartnerText(explicitTarget[1]);
  }

  const questionTarget = input.match(
    /(?:今晚|明天|明晚|周末|周六|周日|周6|周7|星期[一二三四五六日天]|礼拜[一二三四五六天]|下周|下下周)?\s*([\u4e00-\u9fa5A-Za-z]{2,20})(?:有没有人|有人吗|有人去吗)/
  );
  if (questionTarget?.[1]) {
    return trimPartnerText(questionTarget[1]);
  }

  return undefined;
}

function extractLocalLocation(input: string): string | undefined {
  const localMatch = input.match(
    /(观音桥|解放碑|南坪|沙坪坝|江北嘴|杨家坪|大坪|大学城|重庆|附近|本地|同城|[\u4e00-\u9fa5]{2,20}(?:区|镇|街道|商圈|广场|步行街))/
  );
  return localMatch?.[1] ? trimPartnerText(localMatch[1]) : undefined;
}

function isLikelyLocalPlace(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return /(观音桥|解放碑|南坪|沙坪坝|江北嘴|杨家坪|大坪|大学城|重庆|附近|本地|同城)/.test(value);
}

function inferScenarioType(
  input: string,
  activityType: PartnerSemanticType,
  destinationText?: string,
): PartnerScenarioType {
  if (FILL_SEAT_PATTERN.test(input)) {
    return 'fill_seat';
  }

  if (
    activityType === 'event'
    || activityType === 'travel'
    || COMPANION_TRIP_PATTERN.test(input)
    || (DESTINATION_QUESTION_PATTERN.test(input) && destinationText && !isLikelyLocalPlace(destinationText))
  ) {
    return 'destination_companion';
  }

  return 'local_partner';
}

function inferIntentStyle(input: string, scenarioType: PartnerScenarioType): PartnerIntentStyle {
  if (scenarioType === 'fill_seat') {
    return 'seat_fill';
  }

  if (scenarioType === 'destination_companion') {
    return 'companion_trip';
  }

  if (PASSIVE_JOIN_PATTERN.test(input)) {
    return 'passive_join';
  }

  return 'active_invite';
}

function buildNeedsFollowup(params: {
  scenarioType: PartnerScenarioType;
  activityType: PartnerSemanticType;
  locationText?: string;
  destinationText?: string;
  timeText?: string;
}): string[] {
  const needs: string[] = [];

  if (params.activityType === 'other') {
    needs.push('activityType');
  }

  if (params.scenarioType === 'destination_companion') {
    if (!params.destinationText) {
      needs.push('destination');
    }
  } else if (!params.locationText) {
    needs.push('location');
  }

  if (!params.timeText) {
    needs.push('time');
  }

  return needs;
}

export function understandPartnerRequest(input: string): PartnerUnderstanding {
  const normalizedInput = trimPartnerText(input);
  const activityType = inferPartnerSemanticType(normalizedInput);
  const timeText = extractTimeText(normalizedInput);
  const normalizedTimeRange = normalizePartnerTimeRange(normalizedInput);
  const eventInfo = extractEventDestination(normalizedInput);
  const destinationCandidate = eventInfo.destinationText || extractDestinationPlace(normalizedInput);
  const scenarioType = inferScenarioType(normalizedInput, activityType, destinationCandidate);
  const intentStyle = inferIntentStyle(normalizedInput, scenarioType);
  const destinationText = eventInfo.destinationText || (scenarioType === 'destination_companion'
    ? extractDestinationPlace(normalizedInput)
    : undefined);
  const locationText = scenarioType === 'destination_companion'
    ? undefined
    : extractLocalLocation(normalizedInput);
  const needsFollowup = buildNeedsFollowup({
    scenarioType,
    activityType,
    locationText,
    destinationText,
    timeText,
  });

  return {
    scenarioType,
    intentStyle,
    activityType,
    ...(eventInfo.activityText ? { activityText: eventInfo.activityText } : {}),
    ...(locationText ? { locationText } : {}),
    ...(destinationText ? { destinationText } : {}),
    ...(timeText ? { timeText } : {}),
    ...(normalizedTimeRange ? { normalizedTimeRange } : {}),
    constraints: extractConstraintTags(normalizedInput),
    confidence: needsFollowup.length === 0 ? 0.82 : 0.68,
    needsFollowup,
  };
}
