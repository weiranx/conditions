import { LockKeyhole, Mountain, Scale, ShieldCheck } from 'lucide-react';
import type { AppView } from '../../hooks/useUrlState';
import { LegalLinks } from '../../app/legal-links';
import { ProductNav } from './ProductNav';
import '../../styles/legal.css';

type LegalPageKind = 'privacy' | 'terms';

interface LegalViewProps {
  kind: LegalPageKind;
  appShellClassName: string;
  isViewPending: boolean;
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
}

const EFFECTIVE_DATE = 'July 12, 2026';

function PrivacyPolicy() {
  return (
    <>
      <section>
        <h2>What this policy covers</h2>
        <p>
          This policy explains how Backcountry Conditions collects, uses, stores, and shares information
          when you use the website and planning tools. The service does not currently require an account.
        </p>
      </section>

      <section>
        <h2>Information we collect</h2>
        <h3>Plan and location information</h3>
        <p>
          When you search for or select an objective, we process the place name, coordinates, dates, times,
          elevation, travel-window settings, and other planning inputs needed to generate a report. If you
          use your device location, the browser asks for permission before sharing it with the app.
        </p>
        <h3>Technical and usage information</h3>
        <p>
          Our servers receive ordinary request information such as an IP address, browser or device details,
          request time, requested endpoint, and response status. For named report requests, IP addresses are
          masked to a coarse network before storage. Those report logs are limited to 500 entries and retained
          for no more than seven days for reliability, usage measurement, and abuse prevention.
        </p>
        <h3>Information stored on your device</h3>
        <p>
          The app uses browser storage for preferences, recent or saved objectives, interface settings, and a
          recent generated report. This information remains on your device unless you clear it through the app
          or your browser. An administrator access key, if used, is kept only for the browser session.
        </p>
      </section>

      <section>
        <h2>How we use information</h2>
        <ul>
          <li>Generate conditions reports, route analysis, and optional AI-assisted explanations.</li>
          <li>Remember preferences and restore recent planning work on your device.</li>
          <li>Operate, secure, troubleshoot, and improve the service.</li>
          <li>Measure coarse usage patterns and prevent misuse.</li>
        </ul>
        <p>We do not sell personal information or use it for targeted advertising.</p>
      </section>

      <section>
        <h2>When information is shared</h2>
        <p>
          We use service providers to host and deliver the app. Coordinates and related plan inputs may be sent
          to weather, avalanche, mapping, search, terrain, air-quality, snowpack, and similar data providers to
          answer your request. Map-tile and font providers may receive technical request information, including
          your IP address, when their resources load in your browser.
        </p>
        <p>
          If you use an AI feature, the report content, your prompt, and related plan context are sent to the
          configured AI provider (OpenAI or Anthropic) to produce the response. Their handling of that information
          is governed by their own terms and privacy policies.
        </p>
        <p>
          Information may also be disclosed when reasonably necessary to comply with law, protect users or the
          public, enforce these terms, investigate misuse, or protect the service and its operator.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <p>
          You can decline device-location permission and enter an objective manually. You can clear saved browser
          data in the app or through your browser controls, and you can choose not to use optional AI features.
          The service does not currently use operator-controlled cross-site advertising trackers, so it does not
          respond differently to browser “Do Not Track” signals.
        </p>
      </section>

      <section>
        <h2>Security, children, and changes</h2>
        <p>
          We use reasonable safeguards, but no online service can guarantee absolute security. Backcountry
          Conditions is a general-audience planning tool and is not directed to children under 13. We may update
          this policy as the service changes; the effective date above identifies the latest version.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          For privacy questions or requests, email{' '}
          <a href="mailto:weiranxiong@gmail.com">weiranxiong@gmail.com</a>.
        </p>
      </section>
    </>
  );
}

function TermsOfUse() {
  return (
    <>
      <section>
        <h2>Acceptance of these terms</h2>
        <p>
          By accessing or using Backcountry Conditions, you agree to these Terms of Use and the Privacy Policy.
          If you do not agree, do not use the service.
        </p>
      </section>

      <section className="legal-callout">
        <h2>Planning aid only</h2>
        <p>
          Backcountry Conditions is an informational planning aid, not a safety guarantee, emergency service,
          professional guide, avalanche forecast, or substitute for training, judgment, official bulletins, and
          observations in the field. Backcountry travel can cause serious injury or death. Conditions change
          rapidly, and data may be delayed, incomplete, inaccurate, or unavailable.
        </p>
      </section>

      <section>
        <h2>Your responsibilities</h2>
        <p>You are solely responsible for your decisions and safety. You agree to:</p>
        <ul>
          <li>Verify current official forecasts, alerts, closures, and access rules before departure.</li>
          <li>Use appropriate training, equipment, partners, route planning, and conservative judgment.</li>
          <li>Continuously reassess actual conditions and turn around when warranted.</li>
          <li>Use emergency services—not this app—when immediate assistance is needed.</li>
          <li>Comply with applicable laws, permits, land-manager rules, and third-party terms.</li>
        </ul>
      </section>

      <section>
        <h2>Forecasts, third-party data, and AI</h2>
        <p>
          The service combines data and links from government agencies and other third parties. We do not control
          or endorse those services and cannot guarantee their availability, accuracy, timeliness, or fitness for
          your objective. Third-party services are governed by their own terms and policies.
        </p>
        <p>
          AI-generated briefings and chat responses may be incorrect, incomplete, or misleading. Treat them as
          summaries of available inputs, never as authoritative safety advice or a replacement for source material.
        </p>
      </section>

      <section>
        <h2>Permitted use</h2>
        <p>
          You may use the service for lawful, personal planning. You may not interfere with the service, bypass
          access controls, probe for vulnerabilities, overload systems, scrape at unreasonable volume, introduce
          malicious code, impersonate others, or use the service in a way that violates law or harms another person.
        </p>
      </section>

      <section>
        <h2>Intellectual property</h2>
        <p>
          The service’s original software, design, text, and branding are owned by the operator or licensed to the
          operator. Third-party data, maps, marks, and content remain the property of their respective owners. These
          terms do not grant rights beyond the limited permission needed to use the service as provided.
        </p>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p>
          We may change, suspend, restrict, or discontinue any part of the service at any time. We may also update
          these terms; continued use after an update means you accept the revised terms. The effective date above
          identifies the latest version.
        </p>
      </section>

      <section>
        <h2>Disclaimers and limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, the service is provided “as is” and “as available,” without
          warranties of any kind. The operator disclaims implied warranties, including merchantability, fitness for
          a particular purpose, and non-infringement. To the fullest extent permitted by law, the operator will not
          be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, loss of data,
          loss of use, or injury arising from or related to the service or your reliance on it.
        </p>
        <p>Some jurisdictions do not allow certain disclaimers or limitations, so portions of this section may not apply to you.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms may be sent to{' '}
          <a href="mailto:weiranxiong@gmail.com">weiranxiong@gmail.com</a>.
        </p>
      </section>
    </>
  );
}

export function LegalView({
  kind,
  appShellClassName,
  isViewPending,
  navigateToView,
  openPlannerView,
  openTripToolView,
}: LegalViewProps) {
  const isPrivacy = kind === 'privacy';
  const Icon = isPrivacy ? LockKeyhole : Scale;

  return (
    <div className={`${appShellClassName} legal-page-shell`} aria-busy={isViewPending}>
      <ProductNav
        active={kind}
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
        openTripToolView={openTripToolView}
      />
      <main className="legal-page">
        <header className="legal-hero">
          <div className="legal-icon" aria-hidden><Icon /></div>
          <p className="legal-eyebrow">Backcountry Conditions</p>
          <h1>{isPrivacy ? 'Privacy Policy' : 'Terms of Use'}</h1>
          <p className="legal-effective">Effective {EFFECTIVE_DATE}</p>
          <p className="legal-summary">
            {isPrivacy
              ? 'A plain-language explanation of what the service processes, why it is used, and the choices available to you.'
              : 'The rules for using the service and the limits of any conditions report or AI-generated planning support.'}
          </p>
        </header>

        <article className="legal-content">
          {isPrivacy ? <PrivacyPolicy /> : <TermsOfUse />}
        </article>

        <footer className="legal-footer">
          <div><Mountain size={16} aria-hidden /> Backcountry Conditions</div>
          <LegalLinks navigateToView={navigateToView} />
          <span><ShieldCheck size={15} aria-hidden /> Plan conservatively. Verify official sources.</span>
        </footer>
      </main>
    </div>
  );
}
