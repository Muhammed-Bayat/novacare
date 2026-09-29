import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { GeocodingError, type GeocodingService } from './geocoding.service.js';

function sendGeocodingError(error: GeocodingError, res: Response): void {
  const status = error.code === 'GEOCODING_INVALID_INPUT' ? 400
    : error.code === 'GEOCODING_NO_RESULTS' ? 404
      : error.code === 'GEOCODING_RATE_LIMITED' ? 429
        : error.code === 'GEOCODING_CONFIGURATION_ERROR' ? 503
          : 502;
  res.status(status).json({ error: { code: error.code, message: error.message } });
}

export function createGeocodingController(service: GeocodingService) {
  const test: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const address = (req.body as { address?: unknown } | undefined)?.address;
      if (typeof address !== 'string') {
        sendGeocodingError(new GeocodingError('GEOCODING_INVALID_INPUT', 'Provide an address of up to 300 characters.'), res);
        return;
      }
      const candidates = await service.geocode(address);
      res.json({ success: true, candidates });
    } catch (error) {
      if (error instanceof GeocodingError) {
        sendGeocodingError(error, res);
        return;
      }
      next(error);
    }
  };

  return { test };
}
