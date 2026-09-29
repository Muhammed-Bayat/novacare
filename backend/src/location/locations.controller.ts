import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  LocationConfirmationError,
  type LocationResolutionService,
} from './location-resolution.service.js';

function sendConfirmationError(error: LocationConfirmationError, res: Response): void {
  res.status(error.code === 'EXPIRED_CANDIDATE' ? 410 : 400).json({
    error: { code: error.code, message: error.message },
  });
}

export function createLocationsController(service: LocationResolutionService) {
  const resolve: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = (req.body as { address?: unknown } | undefined)?.address;
      if (typeof address !== 'string' || !address.trim() || address.trim().length > 300) {
        res.status(400).json({ error: { code: 'GEOCODING_INVALID_INPUT', message: 'Provide an address of up to 300 characters.' } });
        return;
      }
      const outcome = await service.resolve({ channel: 'WEB', ownerKey: req.auth!.subject, address });
      res.json(outcome);
    } catch (error) {
      next(error);
    }
  };

  const confirm: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const candidateId = (req.body as { candidateId?: unknown } | undefined)?.candidateId;
      if (typeof candidateId !== 'string' || !candidateId) {
        res.status(400).json({ error: { code: 'INVALID_CANDIDATE', message: 'Choose a location to confirm.' } });
        return;
      }
      const candidate = await service.confirm({ channel: 'WEB', ownerKey: req.auth!.subject, candidateId });
      res.json({ status: 'confirmed', candidate });
    } catch (error) {
      if (error instanceof LocationConfirmationError) {
        sendConfirmationError(error, res);
        return;
      }
      next(error);
    }
  };

  return { resolve, confirm };
}
