import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth.js', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { createApp } from './app.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function geminiSuccessPayload() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              pathwayId: 'headache',
              pathwayName: 'Headache & neurological',
              summary: 'Gemini generated summary',
              department: 'General Medicine',
              urgency: 'priority',
              questions: [
                { id: 'q1', text: 'Question one?', type: 'yes-no', options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] },
                { id: 'q2', text: 'Question two?', type: 'scale', min: 0, max: 10 },
              ],
            }),
          }],
        },
      }],
    }),
  };
}

describe('POST /api/v1/questionnaire/intake', () => {
  it('builds the questionnaire with Gemini when available', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => geminiSuccessPayload());
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'I have a bad headache' });
    expect(response.status).toBe(200);
    expect(response.body.data.source).toBe('gemini');
    expect(response.body.data.summary).toBe('Gemini generated summary');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the local pathway questionnaire when Gemini quota is exhausted', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: { code: 429, message: 'quota exceeded' } }) })));
    const response = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'I have a bad headache' });
    expect(response.status).toBe(200);
    expect(response.body.data.source).toBe('local');
    expect(response.body.data.pathwayId).toBe('headache');
    expect(response.body.data.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('skips Gemini while the post-failure cooldown is active', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    // Start beyond the real-clock cooldown left by the previous test, then walk forward.
    const baseTime = Date.now() + 120_000;
    vi.setSystemTime(new Date(baseTime));
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'My chest feels tight' });
    expect(first.body.data.source).toBe('local');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(baseTime + 30_000));
    const second = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'I hurt my ankle today' });
    expect(second.status).toBe(200);
    expect(second.body.data.source).toBe('local');
    expect(second.body.data.pathwayId).toBe('injury');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(baseTime + 61_000));
    const third = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'My chest feels tight' });
    expect(third.body.data.source).toBe('local');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects complaints outside the length limits', async () => {
    const short = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'ab' });
    expect(short.status).toBe(400);
    const long = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'x'.repeat(301) });
    expect(long.status).toBe(400);
  });
});
