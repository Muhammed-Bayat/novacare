import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const USSD_URL = '/api/v1/channels/ussd';
const SESSION = { sessionId: 'AT-session-001', serviceCode: '*384*90210#', phoneNumber: '+27821234567' };
const MAIN_MENU = 'CON Welcome to NovaCare\n1. Request an ambulance\n2. Request a home visit\n3. Check a request';
const AMBULANCE_MENU = 'CON Ambulance request\nIs the patient conscious?\n1. Yes\n2. No';
const HOME_VISIT_MENU = 'CON Home visit request\nPlease select:\n1. Doctor\n2. Nurse\n3. Either';
const REFERENCE_PROMPT = 'CON Enter your NovaCare request reference';
const CONFIRMATION = 'END Thank you. NovaCare received your test request successfully.';
const INVALID_SELECTION = 'END Invalid selection. Please try again.';
const INVALID_REQUEST = 'END NovaCare could not process this request. Please try again.';

describe('USSD channel', () => {
  it('shows the main menu when text is empty', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe(MAIN_MENU);
  });

  it('shows the ambulance menu for option 1', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION, text: '1' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(AMBULANCE_MENU);
  });

  it('shows the home visit menu for option 2', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION, text: '2' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(HOME_VISIT_MENU);
  });

  it('prompts for a request reference for option 3', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION, text: '3' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(REFERENCE_PROMPT);
  });

  it('completes the ambulance flow for accumulated input 1*1', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(CONFIRMATION);
  });

  it('completes the home visit flow for accumulated input 2*3', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION, text: '2*3' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(CONFIRMATION);
  });

  it('completes the reference check for accumulated input 3*NC-12345', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION, text: '3*NC-12345' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(CONFIRMATION);
  });

  it('rejects an invalid menu option', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION, text: '9' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(INVALID_SELECTION);
  });

  it('rejects an invalid sub-option on a valid menu', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ ...SESSION, text: '1*7' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(INVALID_SELECTION);
  });

  it('cannot process a request when a required field is missing', async () => {
    const response = await request(createApp()).post(USSD_URL).type('form').send({ sessionId: SESSION.sessionId, text: '1' });
    expect(response.status).toBe(200);
    expect(response.text).toBe(INVALID_REQUEST);
  });

  it('cannot process a non-form content type', async () => {
    const response = await request(createApp())
      .post(USSD_URL)
      .set('Content-Type', 'text/plain')
      .send('sessionId=AT-session-001&serviceCode=*384*90210%23&phoneNumber=%2B27821234567&text=1');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe(INVALID_REQUEST);
  });
});
