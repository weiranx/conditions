describe('admin audit trail', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_AUDIT_FILE;
    jest.resetModules();
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  test('records newest-first sanitized administrative events', async () => {
    const { getAdminAuditEntries, recordAdminAudit } = require('../src/utils/admin-audit');

    await recordAdminAudit({
      action: 'ai.settings.updated',
      category: 'configuration',
      summary: 'AI controls updated',
      actorIp: '::ffff:203.0.113.42',
      details: { changed: ['enabled'] },
    });
    await recordAdminAudit({
      action: 'diagnostics.completed',
      category: 'diagnostics',
      status: 'error',
      summary: 'Diagnostics failed',
      actorIp: '2001:db8:1234:5678:90ab:cdef:1234:5678',
    });

    const entries = await getAdminAuditEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      action: 'diagnostics.completed',
      category: 'diagnostics',
      status: 'error',
      actorNetwork: '2001:db8:1234:5678::',
    });
    expect(entries[1]).toMatchObject({
      action: 'ai.settings.updated',
      status: 'success',
      actorNetwork: '203.0.113.0',
      details: { changed: ['enabled'] },
    });
    expect(new Date(entries[0].timestamp).getTime()).not.toBeNaN();
  });
});
