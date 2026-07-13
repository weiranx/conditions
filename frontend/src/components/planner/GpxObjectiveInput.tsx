import React from 'react';
import { FileCheck2, LoaderCircle, Upload } from 'lucide-react';
import { parseGpxFile, type ParsedGpxRoute } from '../../lib/gpx';

export interface GpxObjectiveInputProps {
  selectedRoute: ParsedGpxRoute | null;
  onImport: (route: ParsedGpxRoute) => void;
  estimatedDurationHours?: number | null;
  activeDurationHours?: number | null;
  onUseEstimatedDuration?: () => void;
  disabled?: boolean;
}

export function GpxObjectiveInput({
  selectedRoute,
  onImport,
  estimatedDurationHours = null,
  activeDurationHours = null,
  onUseEstimatedDuration,
  disabled = false,
}: GpxObjectiveInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReading(true);
    setError(null);
    try {
      onImport(await parseGpxFile(file));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Could not read this GPX file.');
    } finally {
      setIsReading(false);
      event.target.value = '';
    }
  };

  return (
    <div className="gpx-objective-control">
      <div className="gpx-objective-divider" aria-hidden="true"><span>or</span></div>
      <input
        ref={inputRef}
        className="gpx-objective-file-input"
        type="file"
        accept=".gpx,application/gpx+xml"
        onChange={handleFileChange}
        disabled={disabled || isReading}
        aria-label="Upload a GPX route as the trip objective"
      />
      <button
        type="button"
        className="gpx-objective-button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isReading}
        aria-busy={isReading}
      >
        {isReading ? <LoaderCircle className="spin" size={15} aria-hidden /> : <Upload size={15} aria-hidden />}
        {isReading ? 'Reading GPX…' : selectedRoute ? 'Replace GPX route' : 'Upload GPX route'}
      </button>
      {selectedRoute && (
        <div className="gpx-objective-selected" role="status">
          <FileCheck2 size={15} aria-hidden />
          <span>
            <strong>{selectedRoute.name}</strong>
            <small>
              {selectedRoute.distanceMiles.toFixed(1)} mi · {selectedRoute.elevationGainFt === null ? 'elevation gain unavailable' : `${Math.round(selectedRoute.elevationGainFt).toLocaleString()} ft gain`} · {selectedRoute.routeShape} · {selectedRoute.checkpoints.length} timed checkpoints
            </small>
          </span>
          {estimatedDurationHours !== null && onUseEstimatedDuration && activeDurationHours !== estimatedDurationHours && (
            <button type="button" className="gpx-objective-use-duration" onClick={onUseEstimatedDuration} disabled={disabled}>
              Use {estimatedDurationHours}h estimate
            </button>
          )}
        </div>
      )}
      {error && <p className="gpx-objective-error" role="alert">{error}</p>}
    </div>
  );
}
