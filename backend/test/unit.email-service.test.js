'use strict';

const { createEmailService, normalizeBaseUrl } = require('../src/email/email-service');

describe('transactional email service', () => {
  test('builds a safe verification message and uses a deterministic idempotency key', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'email-123' }, error: null });
    const service = createEmailService({
      apiKey: 're_test',
      fromAddress: 'Backcountry Conditions <accounts@mail.example.com>',
      appBaseUrl: 'https://conditions.example.com/planner?ignored=true',
      client: { emails: { send } },
    });

    await expect(service.sendVerificationEmail({
      tokenId: 'token-row-123',
      token: 'raw-token-value',
      to: 'climber@example.com',
      displayName: '<script>alert(1)</script>',
    })).resolves.toEqual({ id: 'email-123' });

    const [message, options] = send.mock.calls[0];
    expect(message.from).toBe('Backcountry Conditions <accounts@mail.example.com>');
    expect(message.to).toBe('climber@example.com');
    expect(message.html).toContain('https://conditions.example.com/account?action=verify-email&amp;token=raw-token-value');
    expect(message.html).not.toContain('<script>alert(1)</script>');
    expect(message.text).toContain('https://conditions.example.com/account?action=verify-email&token=raw-token-value');
    expect(options).toEqual({ idempotencyKey: 'verify-email/token-row-123' });
  });

  test('creates password reset links and stays disabled when server settings are incomplete', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'reset-email-123' }, error: null });
    const service = createEmailService({
      apiKey: 're_test',
      fromAddress: 'accounts@mail.example.com',
      appBaseUrl: 'https://conditions.example.com',
      client: { emails: { send } },
    });

    await service.sendPasswordResetEmail({
      tokenId: 'reset-row-123',
      token: 'reset-token-value',
      to: 'climber@example.com',
      displayName: 'Avery',
    });
    expect(send.mock.calls[0][0].html).toContain('action=reset-password&amp;token=reset-token-value');
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'reset-password/reset-row-123' });

    expect(createEmailService({ apiKey: '', fromAddress: '', appBaseUrl: '' }).available).toBe(false);
    expect(normalizeBaseUrl('javascript:alert(1)')).toBeNull();
  });

  test('sends escaped, idempotent Objective Watch change alerts to the watches dashboard', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'watch-email-123' }, error: null });
    const service = createEmailService({
      apiKey: 're_test',
      fromAddress: 'accounts@mail.example.com',
      appBaseUrl: 'https://conditions.example.com',
      client: { emails: { send } },
    });

    await service.sendObjectiveWatchChangeEmail({
      eventId: 'event-4',
      changeKey: 'abc123',
      watchId: 'watch-7',
      title: '<Mount Rainier>',
      change: { reasons: [{ label: '<Road closed>' }] },
      to: 'climber@example.com',
      displayName: 'Avery',
    });

    const [message, options] = send.mock.calls[0];
    expect(message.subject).toContain('<Mount Rainier>');
    expect(message.html).toContain('&lt;Road closed&gt;');
    expect(message.html).not.toContain('<Road closed>');
    expect(message.html).toContain('https://conditions.example.com/watches');
    expect(options).toEqual({ idempotencyKey: 'objective-watch/watch-7/event-4/abc123' });
  });

  test('sends owner health alerts with incident-scoped idempotency', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'health-email-123' }, error: null });
    const service = createEmailService({
      apiKey: 're_test',
      fromAddress: 'accounts@mail.example.com',
      appBaseUrl: 'https://conditions.example.com',
      client: { emails: { send } },
    });

    await service.sendHealthStatusEmail({
      incidentId: 'incident-42-opened',
      status: 'unhealthy',
      summary: 'PostgreSQL is unavailable (<connection failed>).',
      checkedAt: '2026-07-14T12:00:00.000Z',
      incidentStartedAt: '2026-07-14T12:00:00.000Z',
      to: 'owner@example.com',
    });

    const [message, options] = send.mock.calls[0];
    expect(message.to).toBe('owner@example.com');
    expect(message.subject).toContain('unhealthy');
    expect(message.html).toContain('&lt;connection failed&gt;');
    expect(message.html).not.toContain('<connection failed>');
    expect(options).toEqual({ idempotencyKey: 'health-monitor/incident-42-opened/unhealthy' });
  });
});
