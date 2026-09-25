import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');

// The top-level jobs and the block of lines under each one.
function jobs() {
  const body = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const result = {};
  let name;
  for (const line of body.split('\n')) {
    const match = /^ {2}([\w-]+):\s*$/.exec(line);
    if (match) result[(name = match[1])] = '';
    else if (name) result[name] += `${line}\n`;
  }
  return result;
}

test('deploys start only after CI passed on a push to main', () => {
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[CI\]\s*\n\s*branches: \[main\]/);
  const { backend } = jobs();
  assert.ok(backend, 'backend job exists');
  for (const condition of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
  ]) {
    assert.ok(backend.includes(condition), `backend job is gated on ${condition}`);
  }
});

test('every other job waits on the gated backend deploy', () => {
  const all = jobs();
  assert.deepEqual(Object.keys(all), ['backend', 'frontend', 'smoke-test']);
  assert.match(all.frontend, /^ {4}needs: backend$/m);
  assert.match(all['smoke-test'], /^ {4}needs: frontend$/m);
  // Only the backend's release decides whether the frontend ships, and no
  // status function (always(), failure()) drops the implicit success() on needs.
  assert.match(all.frontend, /^ {4}if: needs\.backend\.outputs\.released == 'true'$/m);
  assert.doesNotMatch(all['smoke-test'], /^ {4}if:/m);
  assert.doesNotMatch(workflow, /always\(\)|failure\(\)|cancelled\(\)/);
});

test('the frontend ships exactly when the backend released the tested commit', () => {
  const { backend, frontend } = jobs();
  assert.match(backend, /released: \$\{\{ steps\.release\.outputs\.released \}\}/);
  assert.match(backend, /capture_stdout: true/);
  assert.ok(backend.includes('"==> Releasing tested commit $DEPLOY_SHA"'), 'matches the ci-deploy.sh release line');
  const bootstrap = readFileSync(new URL('../ci-deploy.sh', import.meta.url), 'utf8');
  assert.ok(bootstrap.includes('echo "==> Releasing tested commit $DEPLOY_SHA"'), 'ci-deploy.sh prints the release line');
  // A second supersession check could skip a frontend whose backend shipped.
  assert.doesNotMatch(frontend, /ls-remote|superseded/i);
});

test('every job releases the commit that passed CI', () => {
  for (const [name, block] of Object.entries(jobs())) {
    assert.match(block, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/, `${name} checks out head_sha`);
  }
  assert.match(jobs().frontend, /--commit-hash "\$DEPLOY_SHA"/);
});

test('the frontend builds and ships only when frontend/ differs from the live deployment', () => {
  const { frontend } = jobs();
  const steps = frontend.split(/\n(?= {6}- )/).slice(1);
  const check = steps.findIndex((step) => /id: live\n/.test(step));
  assert.ok(check > 0, 'the live check runs after the checkout');
  assert.match(steps[check], /canonical_deployment\.deployment_trigger\.metadata\.commit_hash/);
  assert.match(steps[check], /git diff --quiet "\$live" HEAD -- \./);
  assert.match(frontend, /fetch-depth: 0\n\s+filter: blob:none/);
  for (const step of steps.slice(check + 1)) {
    assert.match(step, /^ {8}if: steps\.live\.outputs\.deploy == 'true'$/m, step.split('\n')[0]);
  }
  // Only the steps skip, so the smoke test still follows every release.
  assert.doesNotMatch(frontend, /outputs:/);
});

test('the backend release skips unchanged images on the droplet', () => {
  const bootstrap = readFileSync(new URL('../ci-deploy.sh', import.meta.url), 'utf8');
  assert.match(bootstrap, /deploy\.sh" --no-pull --no-nginx --skip-unchanged\n/);
});
