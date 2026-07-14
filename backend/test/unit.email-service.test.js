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

  test('sends an escaped complete report only to the supplied account address', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'report-email-123' }, error: null });
    const service = createEmailService({
      apiKey: 're_test',
      fromAddress: 'accounts@mail.example.com',
      appBaseUrl: 'https://conditions.example.com',
      client: { emails: { send } },
    });

    await service.sendReportEmail({
      deliveryKey: 'user-1/report-1/12345',
      to: 'climber@example.com',
      displayName: '<Avery>',
      report: {
        plan: { objectiveName: 'Mount Rainier & Friends', forecastDate: '2026-07-15', alpineStartTime: '05:30', travelWindowHours: 12 },
        preferences: { temperatureUnit: 'c', windSpeedUnit: 'kph', defaultActivity: 'alpine-climbing' },
        safetyData: {
          safety: { score: 72, tier: 'Caution', primaryHazard: 'Upper-mountain wind', confidence: 84, explanations: ['Check wind & <script>alert(1)</script>'] },
          weather: { temp: 35, feelsLike: 29, windSpeed: 12, windGust: 28, precipChance: 20, humidity: 72, cloudCover: 60, description: 'Cloudy', trend: [{ time: '06:00', condition: 'Cloudy', temp: 35, wind: 12, gust: 28, precipChance: 20 }] },
          atmosphere: { freezingLevelFt: 6500, snowLevelFt: 5200, thunderProbability: 10 },
          terrainCondition: { label: 'Firm snow', summary: 'Firm early with wind effect near ridges.', recommendedTravel: 'Carry traction and reassess exposed slopes.' },
          avalanche: { risk: 'Moderate', dangerUnknown: false, bottomLine: 'Wind slabs remain possible near ridgelines.', advice: 'Avoid freshly loaded features.' },
          alerts: { activeCount: 1, alerts: [{ headline: 'High wind warning', instruction: 'Avoid exposed ridges until winds ease.' }] },
          solar: { sunrise: '05:22', sunset: '21:01', dayLength: '15h 39m' },
          snowpack: { summary: 'A long snowpack narrative that must remain complete, including the final sentence.' },
          localConditions: { access: { available: true, roads: [{ name: 'Paradise Road', routeStatus: 'Open' }] } },
          gear: [{ title: 'Ice axe', detail: 'Carry for firm snow travel.', category: 'Snow', tone: 'watch' }],
          partialData: true,
          apiWarning: 'One provider was unavailable.',
        },
        route: {
          customRouteName: 'Disappointment Cleaver',
          routeAnalysis: { analysis: 'Climb the route conservatively and reassess at each waypoint.', summaries: [{ name: 'Ingraham Flats', score: 64 }] },
          gpxRoute: { displayTrack: [{ lat: 46.8, lon: -121.7 }, { lat: 46.9, lon: -121.8 }] },
        },
        ai: {
          aiBriefNarrative: 'The complete AI briefing belongs in the email.',
          snowVisionAnalysis: 'Surface snow appears wind affected near ridgelines.',
          snowVisionImage: 'data:image/jpeg;base64,very-large-image-data',
          reportChatMessages: [{ id: 'chat-1', role: 'assistant', parts: [{ type: 'text', text: 'Recheck the upper mountain wind forecast.' }] }],
        },
      },
    });

    const [message, options] = send.mock.calls[0];
    expect(message.to).toBe('climber@example.com');
    expect(message.subject).toBe('Mount Rainier & Friends report · 2026-07-15');
    expect(message.html).toContain('Mount Rainier &amp; Friends report');
    expect(message.html).toContain('Check wind &amp;');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('Conditions at a glance');
    expect(message.html).toContain('What matters most');
    expect(message.html).toContain('Complete report');
    expect(message.html).toContain('same decision-first order as the app');
    expect(message.html).toContain('Decision snapshot');
    expect(message.html).toContain('Upper-mountain wind');
    expect(message.html).toContain('Weather and travel window');
    expect(message.html).toContain('Hourly travel window');
    expect(message.html).toContain('Surface and atmosphere');
    expect(message.html).toContain('Avalanche conditions');
    expect(message.html).toContain('Wind slabs remain possible');
    expect(message.html).toContain('Snowpack and snow surface');
    expect(message.html).toContain('Alerts, access, and observations');
    expect(message.html).toContain('Route plan and waypoint conditions');
    expect(message.html).toContain('AI briefing and report conversation');
    expect(message.html).toContain('Sources and report details');
    expect(message.html).toContain('including the final sentence.');
    expect(message.html).toContain('Avoid exposed ridges until winds ease.');
    expect(message.html).toContain('Paradise Road');
    expect(message.html).toContain('Disappointment Cleaver');
    expect(message.html).toContain('Climb the route conservatively');
    expect(message.html).toContain('The complete AI briefing belongs in the email.');
    expect(message.html).toContain('Recheck the upper mountain wind forecast.');
    expect(message.html).not.toContain('mapped track points retained');
    expect(message.html).not.toContain('Snow image retained in the saved report');
    expect(message.html).not.toContain('Display Track');
    expect(message.html).not.toContain('Snow Vision Image');
    expect(message.html).not.toContain('very-large-image-data');
    expect(message.html).toContain('Alpine climbing');
    expect(message.html).toContain('05:30 departure · 12h window');
    expect(message.html).toContain('Some source data was incomplete');
    expect(message.html).toContain('font-family:Georgia');
    expect(message.html).not.toContain('undefined');
    expect(message.html).not.toContain('[object Object]');
    expect(message.text).toContain('72/100 · Caution');
    expect(message.text).toContain('2°C, wind 19 kph, gusts 45 kph');
    expect(message.text).toContain('COMPLETE REPORT');
    expect(message.text).toContain('A long snowpack narrative that must remain complete, including the final sentence.');
    expect(message.html).toContain('https://conditions.example.com/');
    expect(options).toEqual({ idempotencyKey: 'report-email/user-1/report-1/12345' });
  });

  test('omits disabled avalanche content from report email output', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'report-email-456' }, error: null });
    const service = createEmailService({
      apiKey: 're_test',
      fromAddress: 'accounts@mail.example.com',
      appBaseUrl: 'https://conditions.example.com',
      client: { emails: { send } },
    });

    await service.sendReportEmail({
      deliveryKey: 'user-1/report-2/12345',
      to: 'climber@example.com',
      report: {
        plan: { objectiveName: 'Weather-only objective', forecastDate: '2026-07-15', alpineStartTime: '06:00' },
        safetyData: {
          featureFlags: {
            avalancheDetails: false,
            airQualityDetails: true,
            fireRiskDetails: true,
            heatRiskDetails: true,
            snowpackDetails: true,
            fieldObservations: true,
            windLoadingDetails: true,
            daylightTimeline: true,
            weatherContextDetails: true,
          },
          safety: {
            score: 80,
            tier: 'Good',
            factors: [{ group: 'avalanche', hazard: 'Avalanche', impact: -25 }],
            explanations: ['Avalanche danger is Considerable.', 'Weather is mild.'],
          },
          weather: { description: 'Mild' },
          avalanche: { risk: 'Considerable', problems: [{ name: 'Deep Persistent Slab' }] },
          alerts: { activeCount: 0 },
        },
      },
    });

    const message = send.mock.calls[0][0];
    expect(message.html).not.toMatch(/Avalanche|Considerable|Deep Persistent Slab/i);
    expect(message.text).not.toMatch(/Avalanche|Considerable|Deep Persistent Slab/i);
    expect(message.html).toContain('Weather is mild.');
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
