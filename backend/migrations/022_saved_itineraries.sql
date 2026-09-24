-- Multi-day trips saved from the trip brief: the itinerary as planned and the
-- day-by-day check it was saved with. A snapshot, like saved_reports.
CREATE TABLE saved_itineraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  day_count INTEGER NOT NULL CHECK (day_count BETWEEN 2 AND 7),
  trip JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX saved_itineraries_user_created_idx
  ON saved_itineraries (user_id, created_at DESC, id DESC);

COMMENT ON COLUMN saved_itineraries.trip IS
  'The trip as the client saved it: { version, draft, preferences, result: { checkedAt, startDate, stages, results } }. Each result holds the safety payload checked for that day.';
