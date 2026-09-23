import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

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
});
