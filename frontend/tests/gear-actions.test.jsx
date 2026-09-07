import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GearActions } from "../src/field/GearActions";

const shell = {
  title: "Shell",
  detail: "Wind protection.",
  category: "Clothing",
  tone: "caution",
};
const lamp = {
  title: "Headlamp",
  detail: "Delayed return.",
  category: "Essentials",
  tone: "neutral",
};
const rescue = {
  title: "Rescue kit",
  detail: "Check equipment.",
  category: "Safety",
  tone: "nogo",
};
const decision = {
  level: "NO-GO",
  blockers: ["Change the exposed route."],
  cautions: ["Allow extra time."],
  checks: [
    {
      key: "wind",
      label: "Wind threshold",
      ok: false,
      action: "Choose sheltered terrain.",
    },
  ],
};
async function mount(t, overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById("root"));
  let props = {
    hidden: false,
    recommendations: [lamp, shell, rescue],
    decision,
    actionLine: "Change the objective window.",
    onSources: () => {},
    ...overrides,
  };
  const render = async (changes = {}, key = "report-a") => {
    props = { ...props, ...changes };
    await act(async () => root.render(<GearActions key={key} {...props} />));
  };
  await render();
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return { render, click: async (node) => act(async () => node.click()) };
}

test("packing sorts priority first, deduplicates items and keeps blockers after completion", async (t) => {
  const h = await mount(t, {
    recommendations: [lamp, shell, rescue, shell, { ...rescue, tone: "neutral" }, { ...lamp, title: " " }],
  });
  assert.deepEqual(
    [...document.querySelectorAll(".gear-item strong")].map(
      (n) => n.textContent,
    ),
    ["Rescue kit", "Shell", "Headlamp"],
  );
  assert.equal(document.querySelector("progress").max, 3);
  for (const input of document.querySelectorAll("input")) await h.click(input);
  assert.equal(document.querySelector("progress").value, 3);
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /List complete/,
  );
  assert.match(
    document.querySelector(".gear-concerns.is-blocked").textContent,
    /Change the exposed route/,
  );
  assert.match(
    document.querySelector(".gear-decision").textContent,
    /Change the plan before packing/,
  );
  await h.click(document.querySelector(".gear-progress button"));
  assert.equal(document.querySelector("progress").value, 0);
  assert.equal(document.querySelectorAll("input:checked").length, 0);
});

test("chapter changes and reorder retain checks but a different report starts fresh", async (t) => {
  const h = await mount(t);
  await h.click(document.querySelector("input"));
  await h.render({ hidden: true });
  assert.equal(document.querySelector(".gear-actions").hidden, true);
  await h.render({ hidden: false, recommendations: [rescue, shell, lamp] });
  assert.equal(document.querySelector("input").checked, true);
  assert.equal(document.querySelector("progress").value, 1);
  await h.render({}, "report-b");
  assert.equal(document.querySelectorAll("input:checked").length, 0);
  assert.equal(document.querySelector("progress").value, 0);
});

test("missing gear has an explicit empty state and preserves source review", async (t) => {
  let reviews = 0;
  const h = await mount(t, { recommendations: [], onSources: () => reviews++ });
  assert.equal(document.querySelector("progress"), null);
  assert.equal(document.querySelector("input"), null);
  assert.match(
    document.querySelector(".gear-kit").textContent,
    /No gear recommendations are available/,
  );
  assert.doesNotMatch(
    document.querySelector(".gear-kit").textContent,
    /List complete/,
  );
  await h.click(document.querySelector(".gear-field-plan button"));
  assert.equal(reviews, 1);
});

test("only unmet checks expose actions and clear reports do not invent warnings", async (t) => {
  const h = await mount(t, {
    decision: {
      ...decision,
      checks: [
        ...decision.checks,
        { label: "Passing check", ok: true, action: "Hidden action" },
      ],
    },
  });
  assert.match(
    document.querySelector(".gear-check-actions").textContent,
    /Needs review.*Wind threshold.*Choose sheltered terrain/,
  );
  assert.doesNotMatch(
    document.querySelector(".gear-check-actions").textContent,
    /Hidden action/,
  );
  await h.render({
    decision: { level: "GO", blockers: [], cautions: [], checks: [] },
  });
  assert.equal(document.querySelector(".gear-concerns"), null);
  assert.match(
    document.querySelector(".gear-field-plan").textContent,
    /No specific adjustments are listed/,
  );
});
