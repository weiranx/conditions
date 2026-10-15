import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/deploy-alert.yml', import.meta.url), 'utf8');
const deployName = /^name: (.+)$/m.exec(readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'))[1];

// The step's shell script, unindented.
const script = (() => {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => /^ {8}run: \|$/.test(line));
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith(' '.repeat(10))) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
})();

// Runs the script with a fake `gh` that answers from `state` and logs each call.
function runAlert({ conclusion, openIssue = '', jobs }) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-alert-'));
  const log = join(dir, 'calls.log');
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\036' "$*" >> "${log}"
case "$1 $2" in
  "issue list") printf '%s' "$FAKE_OPEN_ISSUE" ;;
  "run view") printf '%s' "$FAKE_JOBS" ;;
esac
`);
  chmodSync(join(dir, 'gh'), 0o755);
  writeFileSync(log, '');
  const result = spawnSync('bash', ['-e', '-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CONCLUSION: conclusion,
      RUN_ID: '42',
      RUN_URL: 'https://github.example/runs/42',
      DEPLOY_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
      OWNER: 'owner',
      FAKE_OPEN_ISSUE: openIssue,
      FAKE_JOBS: JSON.stringify(jobs),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(log, 'utf8').split('\x1e').filter((line) => line && !/^(issue list|run view)/.test(line));
}

const failedFrontend = [
  { name: 'backend', conclusion: 'success' },
  { name: 'frontend', conclusion: 'failure' },
  { name: 'smoke-test', conclusion: 'skipped' },
];
const released = [
  { name: 'backend', conclusion: 'success' },
  { name: 'frontend', conclusion: 'success' },
  { name: 'smoke-test', conclusion: 'success' },
];
const superseded = [
  { name: 'backend', conclusion: 'success' },
  { name: 'frontend', conclusion: 'skipped' },
  { name: 'smoke-test', conclusion: 'skipped' },
];

test('follows completed production deploys with only the access it needs', () => {
  assert.match(workflow, new RegExp(`workflow_run:\\n\\s+workflows: \\[${deployName}\\]\\n\\s+types: \\[completed\\]`));
  assert.match(workflow, /^permissions:\n {2}actions: read\n {2}issues: write\n\n/m);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  // Event text (commit messages) never reaches the shell.
  assert.doesNotMatch(workflow, /head_commit|display_title/);
});

test('a failed deploy opens an issue naming the failed job and the owner', () => {
  const calls = runAlert({ conclusion: 'failure', jobs: failedFrontend });
  assert.equal(calls.length, 2, calls.join('\n'));
  assert.match(calls[0], /^label create deploy-failure /);
  assert.match(calls[1], /^issue create --title Production deploy is failing --label deploy-failure --body .*run 42.*`abcdef1`.*Failed job\(s\): frontend\./s);
  assert.match(calls[1], /@owner/);
});

test('another failure comments on the open issue instead of opening a second', () => {
  const calls = runAlert({ conclusion: 'failure', openIssue: '7', jobs: failedFrontend });
  assert.deepEqual(calls.map((call) => call.split(' --body')[0]), ['issue comment 7']);
});

test('a release that passes the smoke test closes the issue', () => {
  const calls = runAlert({ conclusion: 'success', openIssue: '7', jobs: released });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^issue close 7 --comment Production deploy recovered/);
});

test('a superseded commit, which releases nothing, leaves the issue open', () => {
  assert.deepEqual(runAlert({ conclusion: 'success', openIssue: '7', jobs: superseded }), []);
});

test('a success with nothing open does nothing', () => {
  assert.deepEqual(runAlert({ conclusion: 'success', jobs: released }), []);
});
