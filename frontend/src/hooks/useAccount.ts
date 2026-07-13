import { useContext } from 'react';
import { AccountContext } from '../contexts/account';

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) {
    throw new Error('useAccount must be used inside AccountProvider.');
  }
  return account;
}

export type { AccountUser } from '../contexts/account';
