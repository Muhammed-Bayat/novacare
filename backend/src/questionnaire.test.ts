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
});

function geminiResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }),
  };
}

function providerResponse(status: number, message: string, code?: string) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ error: { code: status, status: code, message } }),
  };
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('questionnaire intake', () => {
  it.each([
    ['I twisted my knee playing football and now it hurts to walk.', 'injury'],
    ['My chest feels tight and I am struggling to breathe.', 'chest-breathing'],
    ['I have a sharp pain on the right side of my stomach.', 'abdominal'],
    ['I suddenly developed a very bad headache.', 'headache'],
    ["I've just been feeling generally sick and tired.", 'general'],
  ])('uses one Gemini classification request for %s', async (complaint, pathwayId) => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => geminiResponse({ pathwayId, confidence: 0.92 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ pathwayId, source: 'ai' });
    expect(response.body.data.questions.length).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const prompt = String((requestBody(fetchMock).contents as { parts: { text: string }[] }[])[0]!.parts[0]!.text);
    expect(prompt).toContain('chest-breathing');
    expect(prompt).toContain('injury');
    expect(prompt).toContain('abdominal');
    expect(prompt).toContain('headache');
    expect(prompt).toContain('general');
    expect(prompt).toContain('Do not diagnose, ask questions, determine urgency, recommend a department, recommend a hospital, or provide treatment.');
    expect(prompt).not.toContain('"urgency"');
    expect(prompt).not.toContain('"department"');
  });

  it('normalizes a valid Gemini pathway ID without falling back', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => geminiResponse({ pathwayId: 'CHEST_BREATHING' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'My chest feels tight' });

    expect(response.body.data).toMatchObject({ pathwayId: 'chest-breathing', source: 'ai' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the local classifier, not a forced general pathway, for an unknown Gemini pathway', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => geminiResponse({ pathwayId: 'musculoskeletal-injury' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'I twisted my knee playing football' });

    expect(response.body.data).toMatchObject({ pathwayId: 'injury', source: 'local-fallback', fallbackReason: 'invalid-pathway' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a machine-readable missing-key fallback without calling Gemini', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'I have a bad headache' });

    expect(response.body.data).toMatchObject({ pathwayId: 'headache', source: 'local-fallback', fallbackReason: 'missing-api-key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'API key not valid', 'INVALID_ARGUMENT', 'provider-auth'],
    [401, 'API key not valid', undefined, 'provider-auth'],
    [403, 'Billing account is disabled', undefined, 'provider-billing'],
    [404, 'Model not found', 'NOT_FOUND', 'provider-model'],
    [429, 'Rate limit exceeded', 'RESOURCE_EXHAUSTED', 'provider-rate-limit'],
    [429, 'You exceeded your current quota', 'RESOURCE_EXHAUSTED', 'provider-quota'],
    [503, 'Service unavailable', 'UNAVAILABLE', 'provider-server-error'],
  ])('maps Gemini HTTP %i to %s', async (status, message, code, fallbackReason) => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => providerResponse(status, message, code));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'I have a bad headache' });

    expect(response.body.data).toMatchObject({ pathwayId: 'headache', source: 'local-fallback', fallbackReason });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('distinguishes malformed JSON and schema failures', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not JSON' }] } }] }) }))
      .mockImplementationOnce(async () => geminiResponse({ confidence: 0.5 }));
    vi.stubGlobal('fetch', fetchMock);

    const malformed = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'I have a bad headache' });
    const schema = await request(createApp()).post('/api/v1/questionnaire/intake').send({ complaint: 'I have a bad headache' });

    expect(malformed.body.data.fallbackReason).toBe('invalid-json');
    expect(schema.body.data.fallbackReason).toBe('schema-validation');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evaluates completed questionnaires locally without any Gemini call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp()).post('/api/v1/questionnaire/complete').send({
      pathwayId: 'headache',
      answers: [
        { questionId: 'sudden_onset', value: true },
        { questionId: 'neuro_signs', value: false },
        { questionId: 'pain_level', value: 9 },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ pathwayId: 'headache', department: 'General Medicine', urgency: 'emergency' });
    expect(response.body.data.redFlags).toContain('Sudden severe headache reported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['chest-breathing', [{ questionId: 'chest_now', value: false }, { questionId: 'breath_now', value: false }, { questionId: 'pain_level', value: 4 }, { questionId: 'radiating', value: false }], 'Emergency Department'],
    ['injury', [{ questionId: 'injury_timing', value: 'today' }, { questionId: 'weight_bearing', value: 'painful' }, { questionId: 'deformity', value: false }, { questionId: 'pain_level', value: 4 }], 'Orthopaedics'],
    ['abdominal', [{ questionId: 'pain_location', value: 'lower-right' }, { questionId: 'vomiting', value: false }, { questionId: 'pain_level', value: 4 }, { questionId: 'fainting', value: false }], 'General Medicine'],
    ['headache', [{ questionId: 'sudden_onset', value: false }, { questionId: 'neuro_signs', value: false }, { questionId: 'pain_level', value: 4 }], 'General Medicine'],
    ['general', [{ questionId: 'severity', value: 4 }, { questionId: 'worsening', value: false }, { questionId: 'danger_signs', value: false }], 'General Medicine'],
  ])('keeps %s routing deterministic', async (pathwayId, answers, department) => {
    const response = await request(createApp()).post('/api/v1/questionnaire/complete').send({ pathwayId, answers });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ pathwayId, department });
  });
});
