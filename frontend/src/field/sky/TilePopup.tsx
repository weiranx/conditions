import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import type { CheckStatus } from "./status";
import { chapterLabel, type ReportChapter } from "./report-chapters";

/** What a brief tile shows when opened: the same reading, larger, with its summary. */
export interface TileDetail {
  title: string;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;
  status: CheckStatus;
  value: string;
  caption: string;
  visual?: ReactNode;
  /** The readings behind the tile; shown instead of the mini-chart when present. */
  details?: ReactNode;
  to: ReportChapter;
}

/** A glass popup over the brief, like a weather tile opened on its own. */
export function TilePopup({ detail, onClose, onOpen }: {
  detail: TileDetail;
  onClose: () => void;
  onOpen: (chapter: ReportChapter) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const before = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  const Icon = detail.icon;
  return (
    <dialog
      ref={ref}
      className="sky-popup"
      aria-labelledby="sky-popup-title"
      onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header className="sky-popup-head">
        <h2 id="sky-popup-title">{Icon && <Icon size={16} aria-hidden="true" />}{detail.title}</h2>
        <button type="button" className="sky-popup-close" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      <p className={`sky-popup-value is-${detail.status}`}>{detail.value}</p>
      {(detail.details ?? detail.visual) && <div className="sky-popup-visual">{detail.details ?? detail.visual}</div>}
      <section className="sky-popup-summary" aria-label="Summary">
        <h3>Summary</h3>
        <p>{detail.caption}</p>
      </section>
      <button type="button" className="sky-popup-open" onClick={() => onOpen(detail.to)}>
        Open {chapterLabel(detail.to)}<ChevronRight size={16} aria-hidden="true" />
      </button>
    </dialog>
  );
}
