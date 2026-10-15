import { useEffect, useState } from 'react';

/**
 * How long the top of the report waits for the AI's opening before showing the checks' own:
 * past the 120 s nginx allows an AI read, by which time every read has answered or failed
 * (which ends the wait at once). Only an answer that never arrives reaches it.
 */
export const OPENING_WAIT_MS = 130000;

/**
 * Whether the top of the report waits for the AI's opening instead of showing
 * the checks' wording first and swapping it a few seconds later.
 *
 * It waits only while an opening is `expected`, and at most `ms` per report
 * (`key`): a failed AI ends the wait at once, and a lost answer can't leave the headline blank for good.
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
