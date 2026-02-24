import { Info } from 'lucide-react';

export function HelpHint({ text }: { text: string }) {
  return (
    <span className="help-hint" tabIndex={0} role="note" aria-label="More information">
      <Info size={13} />
      <span className="help-tooltip">{text}</span>
    </span>
  );
}
