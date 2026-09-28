import { describe, expect, it } from 'vitest';
import { createMemoryChannelConversationStore, type ChannelConversation } from './conversation.store.js';

function conversation(overrides: Partial<Omit<ChannelConversation, 'createdAt' | 'updatedAt'>> = {}): Omit<ChannelConversation, 'createdAt' | 'updatedAt'> {
  return {
    channel: 'USSD',
    sessionKey: 'session-1',
    phoneNumber: '+27821234567',
    flow: 'request',
    step: 'reason',
    collectedData: { priority: 'urgent' },
    requestId: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe('memory channel conversation store', () => {
  it('persists and updates conversation state by channel and session key', async () => {
    const store = createMemoryChannelConversationStore();
    await store.save(conversation());
    await store.save(conversation({ step: 'address', collectedData: { priority: 'urgent', address: '1 Main Road' } }));

    const stored = await store.get('USSD', 'session-1');

    expect(stored).toMatchObject({
      channel: 'USSD',
      sessionKey: 'session-1',
      step: 'address',
      collectedData: { priority: 'urgent', address: '1 Main Road' },
    });
    expect(stored?.createdAt).toBeTruthy();
    expect(stored?.updatedAt).toBeTruthy();
  });

  it('clears a conversation without affecting another channel', async () => {
    const store = createMemoryChannelConversationStore();
    await store.save(conversation());
    await store.save(conversation({ channel: 'SMS' }));

    await store.clear('USSD', 'session-1');

    expect(await store.get('USSD', 'session-1')).toBeNull();
    expect(await store.get('SMS', 'session-1')).not.toBeNull();
  });

  it('does not return expired conversations', async () => {
    const store = createMemoryChannelConversationStore();
    await store.save(conversation({ expiresAt: new Date(Date.now() - 1).toISOString() }));

    expect(await store.get('USSD', 'session-1')).toBeNull();
  });

  it('returns the first saved callback receipt for a replay', async () => {
    const store = createMemoryChannelConversationStore();
    await store.saveReceipt('SMS', 'provider-message-1', 'Original response');
    await store.saveReceipt('SMS', 'provider-message-1', 'Later response');

    expect(await store.getReceipt('SMS', 'provider-message-1')).toBe('Original response');
    expect(await store.getReceipt('SMS', 'unknown')).toBeNull();
  });
});
