import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const script = fileURLToPath(new URL('../ci-changed-areas.sh', import.meta.url));
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

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

test('every CI job runs only when its area changed', () => {
  const { changes, ...rest } = jobs();
  assert.ok(changes, 'changes job exists');
  const areas = {
    'pipeline-checks': 'pipeline', 'backend-tests': 'backend', 'frontend-checks': 'frontend', 'mcp-tests': 'mcp',
  };
  assert.deepEqual(Object.keys(rest).sort(), Object.keys(areas).sort());
  for (const [job, area] of Object.entries(areas)) {
    assert.match(rest[job], /^ {4}needs: changes$/m, `${job} needs changes`);
    assert.ok(rest[job].includes(`    if: needs.changes.outputs.${area} == 'true'\n`), `${job} is gated on ${area}`);
    assert.ok(changes.includes(`      ${area}: \${{ steps.areas.outputs.${area} }}\n`), `changes outputs ${area}`);
  }
  // A skipped job passes; a status function would let a failed changes job pass too.
  assert.doesNotMatch(workflow, /always\(\)|failure\(\)|cancelled\(\)/);
});

test('pushes compare against the last main commit whose CI passed', () => {
  const { changes } = jobs();
  assert.match(changes, /actions: read/);
  assert.match(changes, /fetch-depth: 0\n\s+filter: blob:none/);
  assert.ok(changes.includes('actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=1'));
  assert.match(changes, /git rev-parse HEAD\^1/);
  assert.match(changes, /scripts\/ci-changed-areas\.sh "\$BASE" \| tee -a "\$GITHUB_OUTPUT"/);
});

function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'conditions-ci-areas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: gitEnv });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'CI test');
  git('config', 'user.email', 'ci@example.invalid');
  const commit = (files) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    git('add', '--', ...Object.keys(files));
    git('commit', '-m', 'change');
    return git('rev-parse', 'HEAD');
  };
  const base = commit({ 'README.md': 'initial\n' });
  const areas = (from = base) => {
    const result = spawnSync('bash', [script, from], { cwd: root, encoding: 'utf8', env: gitEnv });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(result.stdout.trim().split('\n').map((line) => {
      const [key, value] = line.split('=');
      return [key, value === 'true'];
    }));
  };
  return { commit, areas, base };
}

const none = { backend: false, frontend: false, mcp: false, pipeline: false };
const all = { backend: true, frontend: true, mcp: true, pipeline: true };

for (const [files, expected] of [
  [{ 'ios/App.swift': 'x' }, none],
  [{ 'docs/notes.md': 'x' }, none],
  [{ 'frontend/src/main.tsx': 'x' }, { ...none, frontend: true }],
  [{ 'backend/src/utils/verdict.js': 'x' }, { ...none, backend: true, frontend: true, mcp: true }],
  [{ 'backend/test/unit.x.test.js': 'x' }, { ...none, backend: true, mcp: true }],
  [{ 'mcp/src/tools.js': 'x' }, { ...none, mcp: true }],
  [{ 'scripts/deploy.sh': 'x' }, { ...none, pipeline: true }],
  [{ 'scripts/backend-reload-env.sh': 'x' }, { ...none, backend: true, pipeline: true }],
  [{ '.github/workflows/deploy.yml': 'x' }, { ...none, pipeline: true }],
  [{ '.github/workflows/ci.yml': 'x' }, all],
  [{ 'scripts/ci-changed-areas.sh': 'x' }, all],
]) {
  test(`changing ${Object.keys(files)[0]} runs ${Object.keys(expected).filter((k) => expected[k]).join(', ') || 'nothing'}`, (t) => {
    const r = repo(t);
    r.commit(files);
    assert.deepEqual(r.areas(), expected);
  });
}

test('changes across several commits since the base all count', (t) => {
  const r = repo(t);
  r.commit({ 'frontend/a.ts': 'x' });
  r.commit({ 'mcp/b.js': 'x' });
  assert.deepEqual(r.areas(), { ...none, frontend: true, mcp: true });
});

for (const base of ['', '0'.repeat(40), 'not-a-commit']) {
  test(`an unknown base ${JSON.stringify(base)} runs every job`, (t) => {
    const r = repo(t);
    r.commit({ 'ios/App.swift': 'x' });
    assert.deepEqual(r.areas(base), all);
  });
}
