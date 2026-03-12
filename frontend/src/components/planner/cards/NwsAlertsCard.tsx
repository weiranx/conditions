import { sanitizeExternalUrl } from '../../../app/url-state';
import { normalizeAlertNarrative, splitAlertNarrativeParagraphs } from '../../../app/text-utils';

interface NwsAlert {
  event?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  response?: string;
  effective?: string;
  onset?: string;
  ends?: string;
  expires?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  link?: string;
  affectedAreas?: string[];
  areaDesc?: string;
  senderName?: string;
  messageType?: string;
  category?: string;
}

export interface NwsAlertsCardProps {
  alertsSource: string;
  highestSeverity: string | null | undefined;
  alertsStatus: string | null | undefined;
  nwsTotalAlertCount: number;
  nwsTopAlerts: NwsAlert[];
  formatPubTime: (isoString?: string) => string;
}

export function NwsAlertsCard({
  alertsSource,
  highestSeverity,
  alertsStatus,
  nwsTotalAlertCount,
  nwsTopAlerts,
  formatPubTime,
}: NwsAlertsCardProps) {
  return (
    <>
      <p className="muted-note">
        Source: {alertsSource || 'NWS CAP feed'}
        {highestSeverity ? ` \u2022 Highest: ${highestSeverity}` : ''}
      </p>
      {alertsStatus === 'none_for_selected_start' && nwsTotalAlertCount > 0 && (
        <p className="muted-note">
          {nwsTotalAlertCount} alert(s) exist now, but none are active at your selected start time.
        </p>
      )}
      {nwsTopAlerts.length > 0 ? (
        <ul className="score-trace-list nws-alert-list">
          {nwsTopAlerts.map((alert, idx) => {
            const alertLink = sanitizeExternalUrl(alert.link || undefined);
            const headline = normalizeAlertNarrative(alert.headline, 400);
            const descriptionParagraphs = splitAlertNarrativeParagraphs(alert.description, 2600);
            const instructionParagraphs = splitAlertNarrativeParagraphs(alert.instruction, 1600);
            const areaList = Array.isArray(alert.affectedAreas) ? alert.affectedAreas.filter(Boolean).slice(0, 8) : [];
            const areaDesc = normalizeAlertNarrative(alert.areaDesc, 1200);
            const hasExtendedAlertDetails =
              Boolean(headline) ||
              descriptionParagraphs.length > 0 ||
              instructionParagraphs.length > 0 ||
              areaList.length > 0 ||
              Boolean(areaDesc) ||
              Boolean(alert.senderName) ||
              Boolean(alert.response) ||
              Boolean(alert.messageType) ||
              Boolean(alert.category);
            return (
              <li key={`${alert.event || 'alert'}-${idx}`}>
                <span className="score-trace-hazard">
                  {alertLink ? (
                    <a
                      href={alertLink}
                      target="_blank"
                      rel="noreferrer"
                      className="raw-link-value"
                      title={alert.headline || 'Open NWS alert source'}
                    >
                      {alert.event || 'Alert'}
                    </a>
                  ) : (
                    <span>{alert.event || 'Alert'}</span>
                  )}
                </span>
                <span className="score-trace-impact down">{alert.severity || 'Unknown'}</span>
                <small>
                  {alert.urgency || 'Unknown urgency'}
                  {alert.certainty ? ` \u2022 Certainty ${alert.certainty}` : ''}
                  {alert.response ? ` \u2022 Response ${alert.response}` : ''}
                  {alert.effective ? ` \u2022 Effective ${formatPubTime(alert.effective)}` : ''}
                  {alert.onset ? ` \u2022 Onset ${formatPubTime(alert.onset)}` : ''}
                  {alert.ends ? ` \u2022 Ends ${formatPubTime(alert.ends)}` : ''}
                  {alert.expires ? ` \u2022 Expires ${formatPubTime(alert.expires)}` : ''}
                </small>
                {hasExtendedAlertDetails && (
                  <details className="alert-description-details">
                    <summary title={headline || alert.event || 'Open alert details'}>Details & guidance</summary>
                    <div className="alert-detail-body">
                      {headline && <p className="alert-detail-lead">{headline}</p>}
                      {descriptionParagraphs.length > 0 && (
                        <div className="alert-detail-section">
                          <strong>Description</strong>
                          {descriptionParagraphs.slice(0, 4).map((paragraph, paragraphIdx) => (
                            <p key={`alert-desc-${idx}-${paragraphIdx}`}>{paragraph}</p>
                          ))}
                        </div>
                      )}
                      {instructionParagraphs.length > 0 && (
                        <div className="alert-detail-section">
                          <strong>Recommended Action</strong>
                          {instructionParagraphs.slice(0, 3).map((paragraph, paragraphIdx) => (
                            <p key={`alert-inst-${idx}-${paragraphIdx}`}>{paragraph}</p>
                          ))}
                        </div>
                      )}
                      {areaList.length > 0 && (
                        <div className="alert-detail-section">
                          <strong>Affected Areas</strong>
                          <p>{areaList.join(', ')}</p>
                        </div>
                      )}
                      {areaList.length === 0 && areaDesc && (
                        <div className="alert-detail-section">
                          <strong>Area</strong>
                          <p>{areaDesc}</p>
                        </div>
                      )}
                      {(alert.senderName || alert.messageType || alert.category) && (
                        <div className="alert-detail-section">
                          <strong>Source Metadata</strong>
                          <p>
                            {alert.senderName ? `Issued by ${alert.senderName}` : 'Issuer not specified'}
                            {alert.messageType ? ` \u2022 Type: ${alert.messageType}` : ''}
                            {alert.category ? ` \u2022 Category: ${alert.category}` : ''}
                          </p>
                        </div>
                      )}
                      {alertLink && (
                        <p className="alert-detail-link-line">
                          <a href={alertLink} target="_blank" rel="noreferrer" className="raw-link-value">
                            Open official full alert
                          </a>
                        </p>
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted-note">No active NWS alerts for this objective point.</p>
      )}
    </>
  );
}
