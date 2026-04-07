export interface ParsedSseEvent {
  eventName: string;
  payload: Record<string, unknown> | null;
  dataText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseAiChatSse(raw: string): { events: ParsedSseEvent[]; done: boolean } {
  const packets = raw.split(/\n\n+/);
  const events: ParsedSseEvent[] = [];
  let done = false;

  for (const packet of packets) {
    const trimmed = packet.trim();
    if (!trimmed) {
      continue;
    }

    const lines = trimmed.split(/\r?\n/);
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    const dataText = dataLines.join('\n');
    if (!dataText) {
      continue;
    }

    if (dataText === '[DONE]') {
      done = true;
      continue;
    }

    let payload: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(dataText) as unknown;
      payload = isRecord(parsed) ? parsed : null;
    } catch {
      payload = null;
    }

    const resolvedEvent = payload && typeof payload.event === 'string' ? payload.event : eventName;
    events.push({
      eventName: resolvedEvent,
      payload,
      dataText,
    });
  }

  return { events, done };
}

export function readAiChatSseData(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }

  return isRecord(payload.data)
    ? payload.data
    : payload;
}

export function readAiChatEnvelope<T>(raw: string, label: string): T {
  const parsed = parseAiChatSse(raw);
  if (!parsed.done) {
    throw new Error(`${label}: SSE 未以 [DONE] 结束`);
  }

  const completeEvent = parsed.events.find((event) => event.eventName === 'response-complete');
  if (!completeEvent) {
    throw new Error(`${label}: 缺少 response-complete 事件`);
  }

  const data = readAiChatSseData(completeEvent.payload);
  if (!data) {
    throw new Error(`${label}: response-complete 缺少 envelope`);
  }

  return data as T;
}
