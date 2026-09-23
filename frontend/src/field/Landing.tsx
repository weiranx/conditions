import { useEffect, type CSSProperties } from "react";
import {
  ArrowRight,
  Bell,
  CalendarRange,
  CloudSun,
  Flame,
  Mountain,
  Route,
  ShieldAlert,
  Snowflake,
  Sunrise,
  TriangleAlert,
  Wind,
  type LucideIcon,
} from "lucide-react";
import "./landing.css";

type Signal = { icon: LucideIcon; name: string; source: string };

const SIGNALS: Signal[] = [
  { icon: CloudSun, name: "Weather", source: "NOAA / NWS, Open-Meteo" },
  { icon: ShieldAlert, name: "Avalanche", source: "Avalanche.org centers" },
  { icon: Snowflake, name: "Snowpack", source: "SNOTEL, NOHRSC" },
  { icon: TriangleAlert, name: "Alerts", source: "NWS watches & warnings" },
  { icon: Wind, name: "Air quality", source: "AQI and smoke" },
  { icon: Flame, name: "Fire & heat", source: "Fire weather, heat risk" },
  { icon: Sunrise, name: "Daylight", source: "Sunrise, sunset, twilight" },
  { icon: Mountain, name: "Terrain", source: "Elevation and surface" },
];

const STEPS = [
  {
    title: "Pick your objective",
    body: "Search a peak or trailhead, drop a pin on the map, or import a GPX route.",
  },
  {
    title: "Set your window",
    body: "Choose the date, your start time, and how many hours you expect to be out.",
  },
  {
    title: "Read the brief",
    body: "Get Go, Caution, or No-go with the reasons, hour by hour, and the sources behind them.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CalendarRange,
    title: "Compare days and objectives",
    body: "Rank the next week, or line up several peaks against the same dates to find your Plan A and Plan B.",
  },
  {
    icon: Route,
    title: "Route-aware",
    body: "Import a GPX track to check conditions at each checkpoint along the elevation profile.",
  },
  {
    icon: Bell,
    title: "Watch an objective",
    body: "Save a trip to your watchlist and get notified when the forecast for it changes.",
  },
];

const QUICK_STARTS = [
  { name: "Mount Rainier", lat: 46.8523, lon: -121.7603 },
  { name: "Grand Teton", lat: 43.7417, lon: -110.8024 },
  { name: "Mount Whitney", lat: 36.5785, lon: -118.2923 },
];

/* Illustrative hours for the sample brief: wind builds after midday. */
const SAMPLE_HOURS = [
  { h: "4a", wind: 12 }, { h: "5a", wind: 13 }, { h: "6a", wind: 14 },
  { h: "7a", wind: 15 }, { h: "8a", wind: 17 }, { h: "9a", wind: 19 },
  { h: "10a", wind: 22 }, { h: "11a", wind: 26 }, { h: "12p", wind: 31 },
  { h: "1p", wind: 36 }, { h: "2p", wind: 38 }, { h: "3p", wind: 35 },
];
const WIND_LIMIT = 30;

function plannerLink(peak: { name: string; lat: number; lon: number }) {
  const params = new URLSearchParams({ lat: String(peak.lat), lon: String(peak.lon), name: peak.name });
  return `/planner?${params.toString()}`;
}

function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="80 120 328 220" width={size} height={size * 0.67} aria-hidden="true">
      <path
        d="M96 322 L196 178 L232 218 L292 138 L392 322"
        fill="none"
        stroke="currentColor"
        strokeWidth="30"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SampleBrief() {
  const max = 40;
  return (
    <figure className="landing-brief" aria-label="Sample conditions brief">
      <div className="landing-brief-head">
        <div>
          <span className="landing-mono">Sample brief · Sat 4:00 AM · 11 hr</span>
          <strong>Mount Rainier via Camp Muir</strong>
        </div>
        <span className="landing-verdict">
          <TriangleAlert size={14} aria-hidden="true" />
          Caution
        </span>
      </div>
      <p className="landing-brief-headline">
        Good morning window. Summit wind passes your limit after noon, so plan to turn around by 11:30 AM.
      </p>
      <div className="landing-brief-chart" role="img" aria-label="Wind gusts rise from 12 to 38 mph, crossing the 30 mph limit at noon">
        <div className="landing-brief-chart-label">
          <span className="landing-mono">Gusts, mph</span>
          <span className="landing-mono landing-limit-key">Limit {WIND_LIMIT}</span>
        </div>
        <div className="landing-bars">
          <span className="landing-limit" style={{ bottom: `${(WIND_LIMIT / max) * 100}%` }} />
          {SAMPLE_HOURS.map((hour, index) => (
            <span key={hour.h} className="landing-bar" style={{ "--i": index } as CSSProperties}>
              <span
                className={hour.wind > WIND_LIMIT ? "is-over" : undefined}
                style={{ height: `${(hour.wind / max) * 100}%` }}
              />
              <small>{hour.h}</small>
            </span>
          ))}
        </div>
      </div>
      <dl className="landing-brief-facts">
        <div><dt>Avalanche</dt><dd>Moderate above treeline</dd></div>
        <div><dt>Freezing level</dt><dd>9,800 ft</dd></div>
        <div><dt>Sunrise</dt><dd>6:48 AM</dd></div>
        <div><dt>Sources</dt><dd>7 of 7 fresh</dd></div>
      </dl>
    </figure>
  );
}

export default function Landing() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Backcountry Conditions — Know the mountain before you go";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="landing">
      <a className="landing-skip" href="#landing-main">Skip to content</a>
      <header className="landing-nav">
        <a className="landing-brand" href="/welcome" aria-label="Backcountry Conditions home">
          <BrandMark />
          <span>Backcountry <em>Conditions</em></span>
        </a>
        <nav aria-label="Landing">
          <a href="#how">How it works</a>
          <a href="#signals">Sources</a>
          <a className="landing-nav-cta" href="/">Open planner</a>
        </nav>
      </header>

      <main id="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <span className="landing-mono landing-eyebrow">Backcountry trip planning</span>
            <h1 id="landing-title">
              Know the mountain <span>before you leave the trailhead.</span>
            </h1>
            <p className="landing-lede">
              Weather, avalanche, snowpack, alerts, air quality, and daylight, pulled together for the exact
              hours you’ll be out, with a clear call and the reasons behind it.
            </p>
            <div className="landing-actions">
              <a className="landing-button landing-button-primary" href="/">
                Start planning <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a className="landing-button landing-button-ghost" href="#how">See how it works</a>
            </div>
            <p className="landing-quick">
              <span>Try it:</span>
              {QUICK_STARTS.map((peak) => (
                <a key={peak.name} href={plannerLink(peak)}>{peak.name}</a>
              ))}
            </p>
          </div>
          <SampleBrief />
        </section>

        <section className="landing-section" id="signals" aria-labelledby="landing-signals-title">
          <div className="landing-section-head">
            <span className="landing-mono landing-eyebrow">One brief, many sources</span>
            <h2 id="landing-signals-title">Stop juggling eight browser tabs.</h2>
            <p>
              Every signal is checked against your date, start time, and trip length, and each one shows where it came
              from and how fresh it is.
            </p>
          </div>
          <ul className="landing-signals">
            {SIGNALS.map((signal) => (
              <li key={signal.name}>
                <signal.icon size={20} strokeWidth={1.6} aria-hidden="true" />
                <strong>{signal.name}</strong>
                <span>{signal.source}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section" id="how" aria-labelledby="landing-how-title">
          <div className="landing-section-head">
            <span className="landing-mono landing-eyebrow">How it works</span>
            <h2 id="landing-how-title">From objective to decision in three steps.</h2>
          </div>
          <ol className="landing-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="landing-step-number landing-mono">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section" aria-labelledby="landing-features-title">
          <div className="landing-section-head">
            <span className="landing-mono landing-eyebrow">Beyond a single day</span>
            <h2 id="landing-features-title">Built for how trips actually get planned.</h2>
          </div>
          <div className="landing-features">
            {FEATURES.map((feature) => (
              <article key={feature.title}>
                <feature.icon size={22} strokeWidth={1.6} aria-hidden="true" />
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-final" aria-labelledby="landing-final-title">
          <h2 id="landing-final-title">Your next objective is waiting.</h2>
          <p>No account needed to try it. Sign in to save briefs and watch objectives.</p>
          <a className="landing-button landing-button-primary" href="/">
            Plan an outing <ArrowRight size={17} aria-hidden="true" />
          </a>
          <p className="landing-disclaimer">
            Backcountry Conditions is a planning aid, not a guarantee. Forecasts can be wrong. Verify conditions in the
            field and make your own call.
          </p>
        </section>
      </main>

      <footer className="landing-footer">
        <span className="landing-brand">
          <BrandMark size={22} />
          <span>Backcountry <em>Conditions</em></span>
        </span>
        <nav aria-label="Legal">
          <a href="/status">Status</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
