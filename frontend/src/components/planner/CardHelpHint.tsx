import { Info } from 'lucide-react';

export function HelpHint({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="help-hint"
      aria-label="More information"
      aria-describedby={undefined}
    >
      <Info size={13} aria-hidden="true" />
      <span className="help-tooltip" role="tooltip">{text}</span>
    </button>
  );
}
