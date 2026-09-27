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

function stubGemini(value: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function promptOf(fetchMock: ReturnType<typeof stubGemini>): string {
  const init = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as RequestInit | undefined;
  return String(JSON.parse(String(init?.body)).contents[0].parts[0].text);
}

describe('POST /api/v1/intake/chat', () => {
  it('asks the next question with Gemini when more information is needed', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = stubGemini({
      action: 'question',
      question: { id: 'weight_bearing', text: 'Can you put weight on the injured area?', type: 'single', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
    });
    const response = await request(createApp()).post('/api/v1/intake/chat').send({ complaint: 'I hurt my ankle today' });
    expect(response.status).toBe(200);
    expect(response.body.data.action).toBe('question');
    expect(response.body.data.question.text).toBe('Can you put weight on the injured area?');
    expect(response.body.data.question.options).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(promptOf(fetchMock)).toContain('FEWEST questions');
  });

  it('concludes with a Gemini triage when the model has enough information', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    stubGemini({
      action: 'complete',
      intake: { pathwayId: 'injury', pathwayName: 'Injury & musculoskeletal', summary: 'Ankle injury, unable to bear weight.', department: 'Emergency Department', urgency: 'emergency', redFlags: ['Unable to bear weight'] },
    });
    const response = await request(createApp()).post('/api/v1/intake/chat').send({
      complaint: 'I hurt my ankle today',
      answers: [{ question: 'Can you put weight on the injured area?', answer: 'No' }],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.action).toBe('complete');
    expect(response.body.data.source).toBe('gemini');
    expect(response.body.data.intake).toMatchObject({ urgency: 'emergency', department: 'Emergency Department', pathwayName: 'Injury & musculoskeletal' });
  });

  it('forces a conclusion once the question cap is reached', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const answers = [1, 2, 3, 4].map((n) => ({ question: `Question ${n}?`, answer: 'Yes' }));
    const fetchMock = stubGemini({
      action: 'question',
      question: { id: 'one_more', text: 'One more question?', type: 'yes_no' },
    });
    const response = await request(createApp()).post('/api/v1/intake/chat').send({ complaint: 'I have a bad headache', answers });
    expect(response.status).toBe(200);
    expect(response.body.data.action).toBe('complete');
    expect(['urgent', 'priority']).toContain(response.body.data.intake.urgency);
    expect(promptOf(fetchMock)).toContain('MUST respond with action "complete"');
  });

  it('rejects invalid requests and invalid Gemini responses', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const short = await request(createApp()).post('/api/v1/intake/chat').send({ complaint: 'ab' });
    expect(short.status).toBe(400);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubGemini({ action: 'question', question: { text: '', type: 'yes_no' } });
    const invalid = await request(createApp()).post('/api/v1/intake/chat').send({ complaint: 'I have a bad headache' });
    expect(invalid.status).toBe(502);
    expect(invalid.body.error.code).toBe('INTAKE_CHAT_UNAVAILABLE');
  });

  it('retries a transient Gemini failure before concluding', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: 'question', question: { id: 'fever', text: 'Do you have a fever?', type: 'yes_no' } }) }] } }] }),
      }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(createApp()).post('/api/v1/intake/chat').send({ complaint: 'I have been peeing blood since this morning' });
    expect(response.status).toBe(200);
    expect(response.body.data.action).toBe('question');
    expect(response.body.data.question.text).toBe('Do you have a fever?');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable Gemini error', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(createApp()).post('/api/v1/intake/chat').send({ complaint: 'I have a bad headache' });
    expect(response.status).toBe(200);
    expect(response.body.data.source).toBe('local');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('concludes locally when Gemini quota is exhausted and honours the cooldown', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Start beyond any cooldown left behind by earlier tests (real clock + 2 minutes),
    // then step 30s forward to prove the local conclusion holds during the cooldown.
    const baseTime = Date.now() + 120_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(baseTime);
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await request(createApp()).post('/api/v1/intake/chat').send({ complaint: 'My chest feels tight and I cannot breathe well' });
    expect(first.status).toBe(200);
    expect(first.body.data.action).toBe('complete');
    expect(first.body.data.source).toBe('local');
    expect(first.body.data.intake.urgency).toBe('emergency');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(baseTime + 30_000);
    const second = await request(createApp()).post('/api/v1/intake/chat').send({ complaint: 'I have a bad headache' });
    expect(second.body.data.source).toBe('local');
    expect(second.body.data.intake.pathwayId).toBe('chat-intake');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
