import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { sendSms } from './sms.client.js';
import { SMS_REPLY_AMBULANCE, SMS_REPLY_FALLBACK, SMS_REPLY_HOME } from './sms.service.js';

vi.mock('./sms.client.js', () => ({
  sendSms: vi.fn(async () => ({ messageId: 'ATXid_test', status: 'Success', statusCode: 101 })),
}));

const SMS_URL = '/api/v1/channels/sms/incoming';
const SENDER = '+27821234567';
const sendSmsMock = vi.mocked(sendSms);

async function postIncoming(fields: Record<string, string>) {
  return request(createApp()).post(SMS_URL).type('form').send(fields);
}

describe('SMS incoming channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a urlencoded callback without authentication', async () => {
    const response = await postIncoming({ from: SENDER, to: 'TEST_SHORTCODE', text: 'AMBULANCE' });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('ok');
    await vi.waitFor(() => expect(sendSmsMock).toHaveBeenCalledTimes(1));
  });

  it('sends the ambulance test reply for AMBULANCE', async () => {
    await postIncoming({ from: SENDER, text: 'AMBULANCE' });
    await vi.waitFor(() => expect(sendSmsMock).toHaveBeenCalledTimes(1));
    expect(sendSmsMock).toHaveBeenCalledWith(SENDER, SMS_REPLY_AMBULANCE);
  });

  it('sends the ambulance test reply for lowercase padded input', async () => {
    await postIncoming({ from: SENDER, text: '  ambulance ' });
    await vi.waitFor(() => expect(sendSmsMock).toHaveBeenCalledTimes(1));
    expect(sendSmsMock).toHaveBeenCalledWith(SENDER, SMS_REPLY_AMBULANCE);
  });

  it('sends the home visit test reply for HOME', async () => {
    await postIncoming({ from: SENDER, text: 'HOME' });
    await vi.waitFor(() => expect(sendSmsMock).toHaveBeenCalledTimes(1));
    expect(sendSmsMock).toHaveBeenCalledWith(SENDER, SMS_REPLY_HOME);
  });

  it('sends the fallback test reply for unknown input', async () => {
    await postIncoming({ from: SENDER, text: 'HELLO' });
    await vi.waitFor(() => expect(sendSmsMock).toHaveBeenCalledTimes(1));
    expect(sendSmsMock).toHaveBeenCalledWith(SENDER, SMS_REPLY_FALLBACK);
  });

  it('fails safely when the sender is missing', async () => {
    const response = await postIncoming({ to: 'TEST_SHORTCODE', text: 'AMBULANCE' });
    expect(response.status).toBe(200);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('fails safely when the text is missing', async () => {
    const response = await postIncoming({ from: SENDER });
    expect(response.status).toBe(200);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('fails safely when the text is blank', async () => {
    const response = await postIncoming({ from: SENDER, text: '   ' });
    expect(response.status).toBe(200);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('replies to the number in the from field, even with extra callback fields', async () => {
    await postIncoming({ from: SENDER, to: '28149', text: 'home', date: '2026-09-27 10:00:00', id: 'ATid_1', linkId: 'ATlink_1', networkCode: '99999' });
    await vi.waitFor(() => expect(sendSmsMock).toHaveBeenCalledTimes(1));
    expect(sendSmsMock).toHaveBeenCalledWith(SENDER, SMS_REPLY_HOME);
  });
});
