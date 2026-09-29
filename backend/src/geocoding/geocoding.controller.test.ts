import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./../auth.js', () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    const token = req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
      return;
    }
    req.auth = { subject: token, email: null, displayName: null };
    next();
  },
}));

vi.mock('./../authorization.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../authorization.js')>();
  return {
    ...actual,
    requireRole: () => (req: Request, res: Response, next: NextFunction) => {
      if (req.auth?.subject !== 'admin') {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
        return;
      }
      next();
    },
  };
});

import { createApp } from '../app.js';

function providerResponse(body: unknown): globalThis.Response {
  return { ok: true, status: 200, json: async () => body } as unknown as globalThis.Response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/v1/geocoding/test', () => {
  it('requires authentication', async () => {
    const response = await request(createApp()).post('/api/v1/geocoding/test').send({ address: 'Sandton' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires administrator access', async () => {
    const response = await request(createApp())
      .post('/api/v1/geocoding/test')
      .set('authorization', 'Bearer staff')
      .send({ address: 'Sandton' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns only normalized candidates and never provider credentials or raw payloads', async () => {
    vi.stubEnv('GEOCODING_PROVIDER', 'geoapify');
    vi.stubEnv('GEOAPIFY_API_KEY', 'configured-for-test');
    vi.stubEnv('GEOCODING_COUNTRY', 'za');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(providerResponse({
      results: [{
        formatted: 'Sandton City, Sandton, Johannesburg, South Africa',
        lat: -26.1072,
        lon: 28.0536,
        country: 'South Africa',
        country_code: 'ZA',
        rank: { confidence: 0.9 },
        raw_provider_field: 'must not be exposed',
      }],
      raw_provider_payload: { must_not_be_exposed: true },
    })));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await request(createApp())
      .post('/api/v1/geocoding/test')
      .set('authorization', 'Bearer admin')
      .send({ address: '  Sandton City, Sandton  ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      candidates: [{
        formattedAddress: 'Sandton City, Sandton, Johannesburg, South Africa',
        latitude: -26.1072,
        longitude: 28.0536,
        country: 'South Africa',
        countryCode: 'za',
        confidence: 0.9,
      }],
    });
    expect(JSON.stringify(response.body)).not.toContain('configured-for-test');
    expect(JSON.stringify(response.body)).not.toContain('raw_provider');
  });
});
