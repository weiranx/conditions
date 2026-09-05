import { useEffect, useState } from "react";
import { fetchApi } from "../lib/api-client";
import "./mock-controls.css";

export default function MockControls() {
  const [scenario, setScenario] = useState("mixed");
  const [options, setOptions] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetchApi("/api/dev/mock")
      .then(({ payload }) => {
        const data = payload as { scenario: string; scenarios: string[] };
        setScenario(data.scenario);
        setOptions(data.scenarios);
      })
      .catch(() => setStatus("Mock server unavailable."));
  }, []);
  async function apply(reset = false) {
    setBusy(true);
    try {
      const result = await fetchApi("/api/dev/mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reset ? { reset: true } : { scenario }),
      });
      if (!result.response.ok)
        throw new Error("Could not update the mock scenario.");
      // Explicit user action loads a fresh report at the same objective and selected departure.
      sessionStorage.setItem(
        "summitsafe:mock:scenario",
        reset ? "mixed" : scenario,
      );
      const url = new URL(window.location.href);
      url.searchParams.set("mock_scenario", reset ? "mixed" : scenario);
      if (url.pathname.startsWith("/report/")) url.pathname = "/planner";
      window.location.assign(url.toString());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mock update failed.");
      setBusy(false);
    }
  }
  return (
    <aside className="mock-controls" aria-label="Local development controls">
      <strong>Demo data</strong>
      <span>Premium · Admin</span>
      <label>
        Scenario
        <select
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={() => void apply()}>
        Apply & reload
      </button>
      <details>
        <summary>Test data</summary>
        <button disabled={busy} onClick={() => void apply(true)}>
          Reset mock database
        </button>
        <p>
          Resets mock reports, watches, and account settings. No real services
          are connected.
        </p>
      </details>
      {status && <span role="status">{status}</span>}
    </aside>
  );
}
