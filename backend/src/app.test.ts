import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('NovaCare API', () => {
  it('reports service health', async () => {
    const response = await request(createApp()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('does not expose protected resources without configured authentication', async () => {
    const response = await request(createApp()).get('/api/v1/me');
    expect(response.status).toBe(503);
  });

  it('rejects translation requests with invalid input', async () => {
    const missingTexts = await request(createApp()).post('/api/v1/translate').send({ target: 'zu' });
    expect(missingTexts.status).toBe(400);
    expect(missingTexts.body.error.code).toBe('INVALID_TRANSLATION_REQUEST');

    const unsupportedTarget = await request(createApp()).post('/api/v1/translate').send({ texts: ['Hello'], target: 'xx' });
    expect(unsupportedTarget.status).toBe(400);
  });

  it('returns the original texts when translating to English', async () => {
    const response = await request(createApp()).post('/api/v1/translate').send({ texts: ['Book appointment', 'Find a hospital'], target: 'en' });
    expect(response.status).toBe(200);
    expect(response.body.data.translations).toEqual(['Book appointment', 'Find a hospital']);
  });

  it('translates via the Google Translate endpoint', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrl = url;
      return { ok: true, status: 200, json: async () => [[['Bhuka isikhathi', 'Book appointment', null, null, 10]], null, 'en'] };
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(createApp()).post('/api/v1/translate').send({ texts: ['Book appointment'], target: 'zu' });
    expect(response.status).toBe(200);
    expect(response.body.data.translations).toEqual(['Bhuka isikhathi']);
    const url = new URL(requestedUrl);
    expect(url.searchParams.get('client')).toBe('gtx');
    expect(url.searchParams.get('tl')).toBe('zu');
  });

  it('retries translation when the endpoint is temporarily overloaded', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => [[['Thola isibhedlela', 'Find a hospital', null, null, 10]], null, 'en'] };
    }));
    const response = await request(createApp()).post('/api/v1/translate').send({ texts: ['Find a hospital'], target: 'zu' });
    expect(response.status).toBe(200);
    expect(response.body.data.translations).toEqual(['Thola isibhedlela']);
    expect(calls).toBe(2);
  });
});
