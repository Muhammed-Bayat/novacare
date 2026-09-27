import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getPool } from '../db.js';
import {
  decideResourceAccess,
  loadMembership,
  type Membership,
} from '../authorization.js';
import {
  DispatchValidationError,
  type DispatchService,
} from './dispatch.service.js';
import {
  InvalidTransitionError,
  ServiceRequestConflictError,
  ServiceRequestNotFoundError,
  type ServiceRequestRow,
  type ServiceStatus,
  SERVICE_STATUSES,
  type NotificationResponseStatus,
} from './domain.js';
import { adaptWebRequest } from './channel-adapters.js';
import type { DispatchEventHub } from './events.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dispatch Core §16-17: patient routes are own-record only, dispatcher routes are
 * operational. All simulated — the UI labels everything as demo requests and
 * simulated facilities/responders; nothing here claims a real emergency response.
 */

async function actorUserId(auth0Subject: string): Promise<string | null> {
  const result = await getPool().query<{ id: string }>('SELECT id FROM users WHERE auth0_subject = $1', [auth0Subject]);
  return result.rows[0]?.id ?? null;
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new DispatchValidationError('service request id must be a UUID.');
  }
  return value;
}

function entityId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new DispatchValidationError(`${name} must be a UUID.`);
  }
  return value;
}

async function requiredActorUserId(subject: string): Promise<string> {
  const userId = await actorUserId(subject);
  if (!userId) throw new DispatchValidationError('Your user profile is not synchronized. Call /api/v1/me first.');
  return userId;
}

function mapError(error: unknown, res: Response): boolean {
  if (error instanceof DispatchValidationError) {
    res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    return true;
  }
  if (error instanceof ServiceRequestNotFoundError) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
    return true;
  }
  if (error instanceof InvalidTransitionError) {
    res.status(409).json({ error: { code: 'INVALID_TRANSITION', message: error.message } });
    return true;
  }
  if (error instanceof ServiceRequestConflictError) {
    res.status(409).json({ error: { code: 'CONFLICT', message: error.message } });
    return true;
  }
  return false;
}

async function membershipFor(subject: string): Promise<Membership | null> {
  return loadMembership(subject);
}

function canSeeRequest(membership: Membership | null, row: ServiceRequestRow, userId: string | null): boolean {
  if (membership && (membership.role === 'dispatcher' || membership.role === 'administrator')) return true;
  return decideResourceAccess({
    resource: 'patient.request.read',
    membership,
    actorUserId: userId,
    entityOwnerId: row.requester_user_id,
  }).allowed;
}

export function createDispatchController(service: DispatchService, hub: DispatchEventHub) {
  const createRequest: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const decision = decideResourceAccess({
        resource: 'patient.request.create',
        membership: await membershipFor(req.auth!.subject),
        actorUserId: null,
      });
      if (!decision.allowed) {
        res.status(decision.status).json({ error: { code: decision.code, message: decision.message } });
        return;
      }
      const userId = await actorUserId(req.auth!.subject);
      if (!userId) {
        res.status(403).json({ error: { code: 'USER_NOT_SYNCHRONIZED', message: 'Call /api/v1/me first' } });
        return;
      }
      const input = adaptWebRequest(req.body as Record<string, unknown>, { userId });
      const row = await service.createServiceRequest(input);
      res.status(201).json({ data: row });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  const listMine: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = await actorUserId(req.auth!.subject);
      if (!userId) {
        res.status(403).json({ error: { code: 'USER_NOT_SYNCHRONIZED', message: 'Call /api/v1/me first' } });
        return;
      }
      const rows = await service.listForRequester(userId);
      res.json({ data: rows });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  const getRequest: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await service.getRequest(requestId(req.params.id));
      if (!row) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That service request was not found.' } });
        return;
      }
      const membership = await membershipFor(req.auth!.subject);
      const userId = await actorUserId(req.auth!.subject);
      if (!canSeeRequest(membership, row, userId)) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only access your own requests.' } });
        return;
      }
      res.json({ data: row });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  const events: RequestHandler = (_req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    hub.subscribe(res);
  };

  const queue: RequestHandler = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [data, metrics] = await Promise.all([service.listQueue(), service.listMetrics()]);
      res.json({ data: { ...data, metrics } });
    } catch (error) {
      next(error);
    }
  };

  const detail: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await service.getRequest(requestId(req.params.id));
      if (!row) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That service request was not found.' } });
        return;
      }
      const [history, notifications] = await Promise.all([
        service.listHistory(row.id),
        service.listNotifications(row.id),
      ]);
      res.json({ data: { ...row, history, notifications } });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  const respond: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const facilityId = (req.body as Record<string, unknown>).facilityId;
      const response = (req.body as Record<string, unknown>).response;
      if (typeof facilityId !== 'string' || !facilityId) {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'facilityId is required.' } });
        return;
      }
      if (response !== 'ACKNOWLEDGED' && response !== 'AVAILABLE' && response !== 'UNAVAILABLE' && response !== 'ACCEPTED') {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'response must be ACKNOWLEDGED, AVAILABLE, UNAVAILABLE or ACCEPTED.' } });
        return;
      }
      const userId = await requiredActorUserId(req.auth!.subject);
      const row = await service.respondToNotification(requestId(req.params.id), entityId(facilityId, 'facilityId'), response as Exclude<NotificationResponseStatus, 'PENDING'>, userId);
      res.json({ data: row });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  const acknowledge: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const facilityId = (req.body as Record<string, unknown>).facilityId;
      if (typeof facilityId !== 'string' || !facilityId) {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'facilityId is required.' } });
        return;
      }
      const userId = await requiredActorUserId(req.auth!.subject);
      const row = await service.respondToNotification(requestId(req.params.id), entityId(facilityId, 'facilityId'), 'ACKNOWLEDGED', userId);
      res.json({ data: row });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  const assignFacility: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const facilityId = (req.body as Record<string, unknown>).facilityId;
      if (typeof facilityId !== 'string' || !facilityId) {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'facilityId is required.' } });
        return;
      }
      const userId = await requiredActorUserId(req.auth!.subject);
      const row = await service.assignFacility(requestId(req.params.id), entityId(facilityId, 'facilityId'), userId);
      res.json({ data: row });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  const assignResponder: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const target = {
        responderId: body.responderId === undefined ? undefined : entityId(body.responderId, 'responderId'),
        unitId: body.unitId === undefined ? undefined : entityId(body.unitId, 'unitId'),
      };
      const userId = await requiredActorUserId(req.auth!.subject);
      const row = await service.assignResponder(requestId(req.params.id), target, userId);
      res.json({ data: row });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  const availableResponders: RequestHandler = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.listAvailableResponders();
      res.json({ data });
    } catch (error) {
      next(error);
    }
  };

  const updateStatus: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const status = body.status as ServiceStatus;
      if (!SERVICE_STATUSES.includes(status)) {
        res.status(400).json({ error: { code: 'VALIDATION', message: `status must be one of ${SERVICE_STATUSES.join(', ')}.` } });
        return;
      }
      const userId = await requiredActorUserId(req.auth!.subject);
      const row = await service.updateStatus(requestId(req.params.id), status, userId, {
        note: typeof body.note === 'string' ? body.note : undefined,
        cancelReason: typeof body.cancelReason === 'string' ? body.cancelReason : undefined,
      });
      res.json({ data: row });
    } catch (error) {
      if (mapError(error, res)) return;
      next(error);
    }
  };

  return {
    createRequest,
    listMine,
    getRequest,
    events,
    queue,
    detail,
    respond,
    acknowledge,
    assignFacility,
    assignResponder,
    availableResponders,
    updateStatus,
  };
}
