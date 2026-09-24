import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { usePlanEvaluation } from "../src/hooks/usePlanEvaluation";
import { makeReport } from "../dev/mock-data.mjs";
import { planParams, withEvaluation } from "./evaluation-fixtures";

const wait = (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

test("a failed re-check shows no verdict for the new plan, and a retry restores one", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const report = withEvaluation(makeReport({}, "clear"));
  const stricter = { ...planParams(report), max_gust_mph: "15" };
  const reEvaluated = withEvaluation(report, stricter).evaluation;
  let fail = true;
  globalThis.fetch = async () => (fail
    ? new Response(JSON.stringify({ error: "The plan could not be evaluated." }), { status: 400, headers: { "Content-Type": "application/json" } })
    : new Response(JSON.stringify({ evaluation: reEvaluated }), { headers: { "Content-Type": "application/json" } }));

  let state = null;
  function Probe({ params }) {
    state = usePlanEvaluation(report, params);
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  await act(async () => root.render(<Probe params={planParams(report)} />));
  assert.equal(state.evaluation?.params.max_gust_mph, report.evaluation.params.max_gust_mph, "the report's own evaluation");

  // The plan changes: the last verdict shows only while the new one loads.
  await act(async () => root.render(<Probe params={stricter} />));
  assert.equal(state.pending, true);
  assert.ok(state.evaluation);
  await wait(400);
  assert.equal(state.evaluation, null, "the old verdict is not shown for the new plan");
  assert.equal(state.pending, false);
  assert.ok(state.error);

  fail = false;
  await act(async () => state.retry());
  await wait(400);
  assert.equal(state.error, null);
  assert.equal(state.evaluation?.params.max_gust_mph, "15");
});
