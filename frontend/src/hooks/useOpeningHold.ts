import { useEffect, useState } from 'react';

/** How long the top of the report waits for the AI's opening before showing the checks' own. */
export const OPENING_WAIT_MS = 6000;

/**
 * Whether the top of the report waits for the AI's opening instead of showing
 * the checks' wording first and swapping it a few seconds later.
 *
 * It waits only while an opening is `expected`, and at most `ms` per report
 * (`key`): a slow or failed AI never leaves the headline blank for long.
 * `expired` says the wait ran out while the opening was still expected.
 */
export function useOpeningHold({ expected, key, ms = OPENING_WAIT_MS }: {
  expected: boolean;
  key: string;
  ms?: number;
}): { holding: boolean; expired: boolean } {
  const [expiredKey, setExpiredKey] = useState<string | null>(null);
  const expired = expected && expiredKey === key;
  const holding = expected && !expired;
  useEffect(() => {
    if (!holding) return;
    const timer = window.setTimeout(() => setExpiredKey(key), ms);
    return () => window.clearTimeout(timer);
  }, [holding, key, ms]);
  return { holding, expired };
}
