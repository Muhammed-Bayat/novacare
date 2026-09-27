import type { Response } from 'express';
import type { ServiceChannel, ServiceRequestType, ServiceStatus, ServiceUrgency } from './domain.js';

export type DispatchEventType =
  | 'service-request:created'
  | 'service-request:updated'
  | 'service-request:assigned'
  | 'service-request:status-changed';

/**
 * Minimum-necessary payload (Dispatch Core §18): no patient name, phone, or
 * requester identity ever leaves the server in a broadcast event.
 */
export interface ServiceRequestEventPayload {
  id: string;
  referenceCode: string;
  type: ServiceRequestType;
  urgency: ServiceUrgency;
  status: ServiceStatus;
  channel: ServiceChannel;
  escalationFlag: boolean;
  assignedFacilityId: string | null;
  updatedAt: string;
}

export interface DispatchEvent {
  type: DispatchEventType;
  payload: ServiceRequestEventPayload;
}

export interface DispatchEventHub {
  publish(event: DispatchEvent): void;
  subscribe(res: Response): () => void;
  close(): void;
}

const HEARTBEAT_MS = 25_000;

/**
 * Clean, isolated in-process real-time layer. Server-sent events keep the
 * dispatcher dashboard live without manual refreshes; there is no sensitive
 * broadcast because the payload is already minimum-necessary.
 */
export function createDispatchEventHub(heartbeatMs: number = HEARTBEAT_MS): DispatchEventHub {
  const clients = new Set<Response>();

  const publish = (event: DispatchEvent): void => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      res.write(frame);
    }
  };

  const subscribe = (res: Response): (() => void) => {
    clients.add(res);
    const timer = setInterval(() => res.write(': heartbeat\n\n'), heartbeatMs);
    timer.unref();
    const unsubscribe = (): void => {
      clearInterval(timer);
      clients.delete(res);
    };
    res.on('close', unsubscribe);
    return unsubscribe;
  };

  return { publish, subscribe, close: () => { for (const res of clients) res.end(); } };
}
