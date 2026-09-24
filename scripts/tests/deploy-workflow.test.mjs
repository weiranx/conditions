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
  for (const [name, block] of Object.entries(all)) {
    // A job-level if would replace the implicit success() check on needs.
    if (name !== 'backend') assert.doesNotMatch(block, /^ {4}if:/m, `${name} has no job-level if`);
  }
});

test('every job releases the commit that passed CI', () => {
  for (const [name, block] of Object.entries(jobs())) {
    assert.match(block, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/, `${name} checks out head_sha`);
  }
  assert.match(jobs().frontend, /--commit-hash "\$DEPLOY_SHA"/);
});
