import { useEffect } from "react";
import { ArrowRight, Mountain } from "lucide-react";
import { markLandingSeen } from "../app/landing-gate";
import { loadUserPreferences } from "../app/preferences";
import { SkyHero } from "./sky/SkyHero";
import { buildSkyHours, type PlannedRow } from "./sky/sky-model";
import "./sky/tokens.css";
import "./sky/sky.css";
import "./landing.css";

/* Sample day for the live report header: a clear, calm morning on Rainier,
   then gusts over a 25 mph limit and snow showers from noon. */
const SAMPLE_START = "05:00";
const SAMPLE_SUNRISE = 6 * 60 + 52;
const SAMPLE_SUNSET = 19 * 60 + 10;
const SAMPLE: [string, number, string, number, number][] = [
  ["5:00 AM", 22, "Clear", 12, 0],
  ["6:00 AM", 21, "Clear", 14, 0],
  ["7:00 AM", 24, "Sunny", 15, 0],
  ["8:00 AM", 28, "Mostly sunny", 17, 5],
  ["9:00 AM", 31, "Partly cloudy", 19, 10],
  ["10:00 AM", 33, "Partly cloudy", 22, 15],
  ["11:00 AM", 34, "Mostly cloudy", 24, 25],
  ["12:00 PM", 33, "Cloudy", 29, 35],
  ["1:00 PM", 31, "Snow showers", 33, 55],
  ["2:00 PM", 29, "Snow showers", 35, 70],
  ["3:00 PM", 28, "Snow showers", 31, 60],
  ["4:00 PM", 30, "Mostly cloudy", 24, 30],
];
const GUST_LIMIT = 25;
const PRECIP_LIMIT = 60;

function sampleRows(): PlannedRow[] {
  return SAMPLE.map(([time, temp, condition, gust, precipChance]) => {
    const failedRules = [
      ...(gust > GUST_LIMIT ? [`gust ${gust}>${GUST_LIMIT} mph`] : []),
      ...(precipChance > PRECIP_LIMIT ? [`precip ${precipChance}%>${PRECIP_LIMIT}%`] : []),
    ];
    return {
      time, temp, condition, gust, precipChance, failedRules,
      feelsLike: temp - Math.round(gust / 3),
      wind: Math.round(gust * 0.6),
      pass: failedRules.length === 0,
      reasonSummary: "",
      failedRuleLabels: [],
      complete: true,
    };
  });
}

const SAMPLE_HOURS = buildSkyHours(sampleRows(), {
  start: SAMPLE_START,
  sunriseMinutes: SAMPLE_SUNRISE,
  sunsetMinutes: SAMPLE_SUNSET,
});

function clock(minute: number) {
  const m = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const SOURCES: [string, string, string][] = [
  ["Weather", "Hourly temperature, feels-like, wind, gusts and precipitation across your window, adjusted to your elevation.", "NOAA / NWS, with Open-Meteo filling gaps"],
  ["Avalanche", "Danger by elevation band, the listed avalanche problems and the forecaster’s bottom line, where a center covers the area.", "Avalanche.org and regional centers"],
  ["Snowpack", "Snow depth and water content at the nearest stations, and recent snowfall.", "NRCS SNOTEL, NOAA NOHRSC"],
  ["Alerts", "Active watches, warnings and advisories for the point you picked.", "National Weather Service"],
  ["Air and fire", "Air quality, smoke, nearby fire activity and heat risk.", "AirNow, NASA FIRMS, NIFC"],
  ["Daylight", "Sunrise, sunset, and how much of your window falls in the dark.", "Sunrise-Sunset API"],
  ["Terrain", "Objective elevation, likely trail surface, and conditions at each checkpoint of an imported GPX route.", "USGS, Open-Meteo, OpenStreetMap"],
];

const EXTRAS: [string, string][] = [
  ["Compare days", "Rank the coming days for one objective and open any of them as a full report."],
  ["Compare objectives", "Line up two to five objectives across up to a week of dates, then keep a Plan A and a Plan B."],
  ["Watch an objective", "Save a trip to your watchlist and get an email when its forecast changes."],
];

const RAINIER = "/planner?lat=46.8523&lon=-121.7603&name=Mount%20Rainier";

export default function Landing() {
  useEffect(() => {
    markLandingSeen();
    const previous = document.title;
    document.title = "Backcountry Conditions";
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const mode = loadUserPreferences().themeMode;
    const apply = () => root.setAttribute("data-theme", mode === "system" ? (media?.matches ? "dark" : "light") : mode);
    apply();
    media?.addEventListener?.("change", apply);
    return () => {
      document.title = previous;
      media?.removeEventListener?.("change", apply);
    };
  }, []);

  return (
    <div className="landing">
      <a className="landing-skip" href="#landing-main">Skip to content</a>
      <header className="landing-bar">
        <a className="landing-brand" href="/welcome">
          <Mountain size={22} strokeWidth={1.5} aria-hidden="true" />
          Backcountry Conditions
        </a>
        <nav aria-label="Site">
          <a href="#sources">Sources</a>
          <a href="/">Open the planner</a>
        </nav>
      </header>

      <main id="landing-main">
        <section className="landing-intro" aria-labelledby="landing-title">
          <h1 id="landing-title">Conditions for the hours you’ll actually be out.</h1>
          <p>
            Pick an objective, a start time and how long you’ll be out. Backcountry Conditions reads the forecast, the
            avalanche bulletin, snowpack, alerts, smoke and daylight, checks each hour against your own limits, and
            shows you which ones need a second look.
          </p>
          <div className="landing-actions">
            <a className="landing-button" href="/">Plan an outing</a>
            <a className="landing-link" href={RAINIER}>
              Or start with Mount Rainier <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </section>

        <figure className="landing-demo">
          <div className="sky-report">
            <SkyHero
              hours={SAMPLE_HOURS}
              sunrise={SAMPLE_SUNRISE}
              sunset={SAMPLE_SUNSET}
              kicker="Sample conditions report"
              title="Mount Rainier"
              titleAs="h2"
              subtitle="Saturday · 5:00 AM start · 12 hours · 14,411 ft"
              level="CAUTION"
              headline="Summit by noon or turn around early."
              reason="The morning is clear with light wind. From noon, gusts pass your 25 mph limit and snow showers move in."
              format={{
                temp: (f) => `${Math.round(f)}°F`,
                wind: (mph) => `${Math.round(mph)} mph`,
                clock,
                timeStyle: "12h",
              }}
            />
          </div>
          <figcaption>
            The top of a real report, running on sample data. Hover, click or drag across the sky, or use the arrow keys, to read any hour.
          </figcaption>
        </figure>

        <section className="landing-section" id="sources" aria-labelledby="landing-sources-title">
          <header>
            <h2 id="landing-sources-title">What goes into a brief</h2>
            <p>
              Every source carries the time it was last updated. Anything stale or missing is marked in the report
              rather than quietly left out.
            </p>
          </header>
          <dl className="landing-sources">
            {SOURCES.map(([name, what, from]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{what}</dd>
                <dd className="landing-source-from">{from}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="landing-section" aria-labelledby="landing-extras-title">
          <header>
            <h2 id="landing-extras-title">When one day isn’t the question</h2>
            <p>Most trips start with a window, not a date.</p>
          </header>
          <dl className="landing-extras">
            {EXTRAS.map(([name, body]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="landing-aid" aria-labelledby="landing-aid-title">
          <figure>
            <img
              src="/hero-rainier.jpg"
              width={1672}
              height={941}
              loading="lazy"
              alt="Mount Rainier above a sea of cloud, with a lenticular cloud capping the summit"
            />
            <figcaption>A lenticular cap on Rainier: a sign of strong wind over the summit.</figcaption>
          </figure>
          <div>
            <h2 id="landing-aid-title">A planning aid, not a verdict</h2>
            <p>
              Forecasts miss. Avalanche bulletins cover whole regions. Nothing here has seen your slope today.
            </p>
            <p>
              Use the brief to decide whether a day is worth a closer look and what to watch for, then make the call
              on the ground.
            </p>
            <div className="landing-actions">
              <a className="landing-button" href="/">Plan an outing</a>
              <span className="landing-note">No account needed. Sign in to save reports and watch objectives.</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Backcountry Conditions</span>
        <nav aria-label="Legal">
          <a href="/status">Status</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
