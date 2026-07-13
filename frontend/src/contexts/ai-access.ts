import { createContext } from 'react';

export interface AiAccessContextValue {
  requestAiAccess: () => boolean;
}

export const AiAccessContext = createContext<AiAccessContextValue | null>(null);
