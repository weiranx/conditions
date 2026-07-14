export interface AccountLinkAction {
  type: 'verify-email' | 'reset-password';
  token: string;
}

export const readAccountLinkAction = (): AccountLinkAction | null => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  const token = params.get('token')?.trim() || '';
  if (!token || (action !== 'verify-email' && action !== 'reset-password')) return null;
  return { type: action, token };
};
