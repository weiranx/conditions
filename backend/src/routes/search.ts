import { Express, Request, Response } from 'express';

const normalizeSearchText = (value: string = '') =>
  String(value)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\s+/g, ' ')
    .trim();

interface RegisterSearchRoutesOptions {
  app: Express;
  fetchWithTimeout: Function;
  defaultFetchHeaders: any;
  peaks: any[];
}

export const registerSearchRoutes = ({ app, fetchWithTimeout, defaultFetchHeaders, peaks }: RegisterSearchRoutesOptions) => {
  app.get('/api/search', async (req: Request, res: Response) => {
    const { q } = req.query;
    const query = typeof q === 'string' ? q.trim().slice(0, 120) : '';
    const normalizedQuery = normalizeSearchText(query);

    if (!query) {
      return res.json(peaks.slice(0, 5).map((peak) => ({ ...peak, type: 'peak', class: 'popular' })));
    }

    const localMatches = peaks
      .filter((peak) => normalizeSearchText(peak.name).includes(normalizedQuery))
      .map((peak) => ({ ...peak, type: 'peak', class: 'natural' }));

    if (query.length < 3) return res.json(localMatches);

    try {
      const fetchOptions = { headers: defaultFetchHeaders };
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=5&addressdetails=1`;
      const response = await fetchWithTimeout(url, fetchOptions);
      if (!response.ok) {
        throw new Error(`Nominatim request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const apiResults = payload.map((item: any) => ({
        name: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        type: item.type,
        class: item.class,
      }));

      const combined = [...localMatches, ...apiResults];
      const uniqueResults = combined
        .filter((value, index, array) => array.findIndex((entry) => entry.name === value.name) === index)
        .slice(0, 8);

      return res.json(uniqueResults);
    } catch (error) {
      return res.json(localMatches);
    }
  });
};
