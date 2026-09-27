import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { createDispatchEventHub, type DispatchEvent } from './events.js';

function fakeResponse() {
  const written: string[] = [];
  const handlers = new Map<string, () => void>();
  const res = {
    written,
    write: (chunk: string) => written.push(chunk),
    on: (event: string, handler: () => void) => handlers.set(event, handler),
    end: vi.fn(),
    close: () => handlers.get('close')?.(),
  };
  return res as unknown as Response & { written: string[]; close: () => void; end: ReturnType<typeof vi.fn> };
}

function event(type: DispatchEvent['type']): DispatchEvent {
  return {
    type,
    payload: {
      id: 'req-1',
      referenceCode: 'NC-2026-000001',
      type: 'AMBULANCE',
      urgency: 'URGENT',
      status: 'NOTIFIED',
      channel: 'USSD',
      escalationFlag: false,
      assignedFacilityId: null,
      updatedAt: new Date().toISOString(),
    },
  };
}

describe('dispatch event hub', () => {
  it('frames published events as server-sent data', () => {
    const hub = createDispatchEventHub();
    const res = fakeResponse();
    hub.subscribe(res);
    const published = event('service-request:created');
    hub.publish(published);
    expect(res.written).toHaveLength(1);
    expect(res.written[0]).toBe(`data: ${JSON.stringify(published)}\n\n`);
    hub.close();
  });

  it('fans out to every subscribed client', () => {
    const hub = createDispatchEventHub();
    const a = fakeResponse();
    const b = fakeResponse();
    hub.subscribe(a);
    hub.subscribe(b);
    hub.publish(event('service-request:assigned'));
    expect(a.written).toHaveLength(1);
    expect(b.written).toHaveLength(1);
    hub.close();
  });

  it('stops writing to a client after it closes', () => {
    const hub = createDispatchEventHub();
    const res = fakeResponse();
    hub.subscribe(res);
    res.close();
    hub.publish(event('service-request:status-changed'));
    expect(res.written).toHaveLength(0);
    hub.close();
  });

  it('ends all clients when the hub closes', () => {
    const hub = createDispatchEventHub();
    const res = fakeResponse();
    hub.subscribe(res);
    hub.close();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('emits heartbeats on the requested interval until unsubscribed', () => {
    vi.useFakeTimers();
    try {
      const hub = createDispatchEventHub(1000);
      const res = fakeResponse();
      const unsubscribe = hub.subscribe(res);
      vi.advanceTimersByTime(2500);
      expect(res.written.filter((c) => c.includes(': heartbeat'))).toHaveLength(2);
      unsubscribe();
      vi.advanceTimersByTime(5000);
      expect(res.written.filter((c) => c.includes(': heartbeat'))).toHaveLength(2);
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
