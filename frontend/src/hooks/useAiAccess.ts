import { useContext } from 'react';
import { AiAccessContext } from '../contexts/ai-access';

export function useAiAccess() {
  const access = useContext(AiAccessContext);
  if (!access) {
    throw new Error('useAiAccess must be used inside AiAccessContext.');
  }
  return access;
}
