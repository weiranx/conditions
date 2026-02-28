import { Express, Request, Response } from 'express';

interface RegisterSatOneLinerRouteOptions {
  app: Express;
  invokeSafetyHandler: (query: any) => Promise<{ statusCode: number; payload: any }>;
  buildSatOneLiner: (options: any) => string;
  parseStartClock: (value: string) => string | null;
}

export const registerSatOneLinerRoute = ({
  app,
  invokeSafetyHandler,
  buildSatOneLiner,
  parseStartClock,
}: RegisterSatOneLinerRouteOptions) => {
  app.get('/api/sat-oneliner', async (req: Request, res: Response) => {
    const { lat, lon, date, start, objective, name, maxLength } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
      return res.status(400).json({ error: 'Latitude/longitude must be valid decimal coordinates.' });
    }

    const requestedDate = typeof date === 'string' ? date.trim() : '';
    if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const normalizedStart = parseStartClock(typeof start === 'string' ? start : '') || '';
    const requestedMaxLength = Number(maxLength);
    if (maxLength !== undefined && (!Number.isFinite(requestedMaxLength) || requestedMaxLength < 80 || requestedMaxLength > 320)) {
      return res.status(400).json({ error: 'maxLength must be a number between 80 and 320.' });
    }

    try {
      const safetyResult = await invokeSafetyHandler({
        lat: String(parsedLat),
        lon: String(parsedLon),
        date: requestedDate || undefined,
        start: normalizedStart || undefined,
      });

      if (safetyResult.statusCode !== 200 || !safetyResult.payload || typeof safetyResult.payload !== 'object') {
        return res.status(safetyResult.statusCode || 502).json(
          safetyResult.payload && typeof safetyResult.payload === 'object'
            ? safetyResult.payload
            : { error: 'Unable to build SAT one-liner from safety report.' },
        );
      }

      const objectiveName = String(objective || name || '').trim();
      const satLine = buildSatOneLiner({
        safetyPayload: safetyResult.payload,
        objectiveName,
        startClock: normalizedStart,
        maxLength: Number.isFinite(requestedMaxLength) ? requestedMaxLength : 170,
      });

      return res.status(200).json({
        line: satLine,
        length: satLine.length,
        maxLength: Number.isFinite(requestedMaxLength) ? requestedMaxLength : 170,
        generatedAt: new Date().toISOString(),
        sourceGeneratedAt: safetyResult.payload.generatedAt || null,
        partialData: Boolean(safetyResult.payload.partialData),
        source: '/api/safety',
        params: {
          lat: parsedLat,
          lon: parsedLon,
          date: requestedDate || safetyResult.payload?.forecast?.selectedDate || null,
          start: normalizedStart || null,
          objective: objectiveName || null,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'Failed to generate SAT one-liner.',
        details: error?.message || 'Unknown backend error.',
      });
    }
  });
};
