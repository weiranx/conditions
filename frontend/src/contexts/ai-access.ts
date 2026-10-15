import { createContext } from 'react';

export interface AiAccessContextValue {
  requestAiAccess: () => boolean;
  /** The traveler's choice on the plan form; off, every AI feature is unavailable. */
  aiEnabled: boolean;
}

export const AiAccessContext = createContext<AiAccessContextValue | null>(null);
