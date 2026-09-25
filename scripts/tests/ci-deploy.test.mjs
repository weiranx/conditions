import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bootstrap = fileURLToPath(new URL('../ci-deploy.sh', import.meta.url));
const deployScript = fileURLToPath(new URL('../deploy.sh', import.meta.url));
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', env: gitEnv, timeout: 10_000, ...options });
  assert.equal(result.status, 0, `${program} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'conditions-ci-deploy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin');
  const host = join(root, 'host');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const env = {
    ...gitEnv, PATH: `${bin}:${process.env.PATH}`, SUMMITSAFE_APP_DIR: host,
    TEST_BUILD_EXIT: '0', TEST_MIGRATION_EXIT: '0', TEST_HEALTH_EXIT: '0',
    TEST_BACKEND_RUNNING: '1', TEST_ROLLBACK_HEALTHY: '0', TEST_MONITOR_EXIT: '0',
    TEST_MCP_BUILD_EXIT: '0', TEST_MCP_HEALTH_EXIT: '0', TEST_MCP_RUNNING: '1', TEST_MCP_ROLLBACK_HEALTHY: '0',
  };
  // macOS lacks the flock CLI. Use the same OS flock primitive for local tests;
  // Ubuntu CI and production use util-linux flock, including the contention test.
  if (spawnSync('flock', ['--version']).error?.code === 'ENOENT') {
    writeFileSync(join(bin, 'flock'), '#!/usr/bin/env python3\nimport fcntl, sys\ntry:\n    fcntl.flock(int(sys.argv[-1]), fcntl.LOCK_EX | fcntl.LOCK_NB)\nexcept BlockingIOError:\n    sys.exit(1)\n');
    chmodSync(join(bin, 'flock'), 0o755);
  }
  const git = (cwd, ...args) => command('git', args, { cwd, env });
  git(root, 'init', '--initial-branch=main', origin);
  git(origin, 'config', 'user.name', 'CI test');
  git(origin, 'config', 'user.email', 'ci@example.invalid');
  mkdirSync(join(origin, 'scripts'));
  writeFileSync(join(origin, 'scripts', 'deploy.sh'), readFileSync(deployScript));
  chmodSync(join(origin, 'scripts', 'deploy.sh'), 0o755);
  writeFileSync(join(origin, 'docker-compose.yml'), '# test fixture\n');
  writeFileSync(join(origin, 'app.txt'), 'initial\n');
  git(origin, 'add', 'scripts/deploy.sh', 'docker-compose.yml', 'app.txt');
  git(origin, 'commit', '-m', 'initial');
  const initial = git(origin, 'rev-parse', 'HEAD');
  git(root, 'clone', origin, host);
  writeFileSync(join(host, '.env'), '# no external services or secrets in tests\n');
  // Exercise the real deploy script and inherited lock, but never call Docker,
  // curl, cron, or nginx on the developer machine or contact an external host.
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$SUMMITSAFE_APP_DIR/docker-calls.txt"
if [ "$*" = 'compose build --pull backend' ]; then
  test "$(git rev-parse HEAD)" = "$DEPLOY_SHA"
  exec 8>"$SUMMITSAFE_APP_DIR/.git/summitsafe-deploy.lock"
  if flock -n 8; then
    echo 'Deployment lock was released before the build' >&2
    exit 50
  fi
  exit "$TEST_BUILD_EXIT"
fi
if [ "$*" = 'compose up -d --force-recreate --no-deps health-monitor' ]; then
  exit "$TEST_MONITOR_EXIT"
fi
if [ "$*" = 'compose run --rm --no-deps backend npm run db:migrate' ]; then
  exit "$TEST_MIGRATION_EXIT"
fi
if [ "$*" = 'compose ps --quiet backend' ] && [ "$TEST_BACKEND_RUNNING" = 1 ]; then
  echo running-backend-container
fi
if [ "$*" = 'inspect --format {{.Image}} running-backend-container' ]; then
  echo sha256:running-image
fi
case "$*" in
  *'conditions-mcp'*'build --pull conditions-mcp') exit "$TEST_MCP_BUILD_EXIT" ;;
  *'conditions-mcp'*'ps --quiet conditions-mcp') [ "$TEST_MCP_RUNNING" = 1 ] && echo running-mcp-container ;;
  'inspect --format {{.Image}} running-mcp-container') echo sha256:running-mcp-image ;;
esac
exit 0
`);
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
case "$*" in *127.0.0.1:8104*)
  printf '%s\\n' "$*" >> "$SUMMITSAFE_APP_DIR/mcp-health-calls.txt"
  if [ "$TEST_MCP_ROLLBACK_HEALTHY" = 1 ] \\
    && grep -qx 'image tag conditions-mcp:rollback conditions-mcp:latest' "$SUMMITSAFE_APP_DIR/docker-calls.txt"; then
    printf '%s\\n' '{"status":"ok"}'
    exit 0
  fi
  if [ "$TEST_MCP_HEALTH_EXIT" != 0 ]; then exit "$TEST_MCP_HEALTH_EXIT"; fi
  printf '%s\\n' '{"status":"ok"}'
  exit 0
esac
printf '%s\\n' "$*" >> "$SUMMITSAFE_APP_DIR/health-calls.txt"
if [ "$TEST_ROLLBACK_HEALTHY" = 1 ] \\
  && grep -qx 'image tag summitsafe-backend:rollback summitsafe-backend:latest' "$SUMMITSAFE_APP_DIR/docker-calls.txt"; then
  printf '%s\\n' '{"ok":true}'
  exit 0
fi
if [ "$TEST_HEALTH_EXIT" != 0 ]; then exit "$TEST_HEALTH_EXIT"; fi
printf '%s\\n' '{"ok":true}'
`);
  writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  for (const tool of ['docker', 'curl', 'sleep']) chmodSync(join(bin, tool), 0o755);
  return {
    root, origin, host, env, initial, git,
    advance() {
      writeFileSync(join(origin, 'app.txt'), 'updated\n');
      git(origin, 'add', 'app.txt');
      git(origin, 'commit', '-m', 'update');
      return git(origin, 'rev-parse', 'HEAD');
    },
    run(sha = initial, overrides = {}) {
      return spawnSync('bash', [bootstrap], {
        cwd: root, env: { ...env, DEPLOY_SHA: sha, ...overrides }, encoding: 'utf8', timeout: 10_000,
      });
    },
    enableMcp() {
      mkdirSync(join(host, 'mcp'));
      writeFileSync(join(host, 'mcp', 'compose.yaml'), '# test fixture\n');
      writeFileSync(join(host, 'mcp', '.env'), '# no secrets in tests\n');
    },
    calls() {
      const file = join(host, 'docker-calls.txt');
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    },
  };
}

function assertNotDeployed(f, result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
  assert.equal(f.calls(), '');
}

test('fast-forwards to the tested SHA and holds the shared lock through the real deploy script', (t) => {
  const f = fixture(t);
  const sha = f.advance();
  const result = f.run(sha);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git(f.host, 'rev-parse', 'HEAD'), sha);
  assert.match(result.stdout, /Deploy complete/);
  assert.match(f.calls(), /compose build --pull backend/);
  assert.match(f.calls(), /compose up -d --force-recreate --no-deps backend/);
  assert.doesNotMatch(result.stdout, /Pulling latest/);
  assert.match(f.calls(), /inspect --format \{\{\.Image\}\} running-backend-container\nimage tag sha256:running-image summitsafe-backend:rollback\ncompose build --pull backend/);
  assert.match(f.calls(), /image prune --force/);
  assert.match(f.calls(), /builder prune --force --filter until=168h/);
});

test('can retry the current tested commit', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(f.git(f.host, 'rev-parse', 'HEAD'), f.initial);
});

test('skips a superseded CI run without checking out or deploying newer untested main', (t) => {
  const f = fixture(t);
  f.advance();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skipping superseded commit/);
  assert.equal(f.git(f.host, 'rev-parse', 'HEAD'), f.initial);
  assert.equal(f.calls(), '');
});

test('an older successful run cannot roll back a newer release', (t) => {
  const f = fixture(t);
  const sha = f.advance();
  assert.equal(f.run(sha).status, 0);
  const previousCalls = f.calls();
  assert.equal(f.run(f.initial).status, 0);
  assert.equal(f.git(f.host, 'rev-parse', 'HEAD'), sha);
  assert.equal(f.calls(), previousCalls);
});

for (const sha of ['', 'main', 'abc123', '$(touch should-not-exist)', 'a'.repeat(39)]) {
  test(`rejects invalid commit input ${JSON.stringify(sha)}`, (t) => {
    const f = fixture(t);
    assertNotDeployed(f, f.run(sha), /full commit SHA/);
    assert.equal(existsSync(join(f.root, 'should-not-exist')), false);
  });
}

for (const staged of [false, true]) {
  test(`preserves ${staged ? 'staged' : 'unstaged'} production changes`, (t) => {
    const f = fixture(t);
    writeFileSync(join(f.host, 'app.txt'), 'host edit\n');
    if (staged) f.git(f.host, 'add', 'app.txt');
    assertNotDeployed(f, f.run(), /Tracked changes/);
    assert.equal(readFileSync(join(f.host, 'app.txt'), 'utf8'), 'host edit\n');
  });
}

test('refuses a detached production checkout', (t) => {
  const f = fixture(t);
  f.git(f.host, 'checkout', '--detach');
  assertNotDeployed(f, f.run(), /detached/);
});

test('refuses a production branch other than main', (t) => {
  const f = fixture(t);
  f.git(f.host, 'checkout', '-b', 'hotfix');
  assertNotDeployed(f, f.run(), /must be on main/);
});

for (const divergent of [false, true]) {
  test(`preserves production commits when main is ${divergent ? 'divergent' : 'ahead'}`, (t) => {
    const f = fixture(t);
    const target = divergent ? f.advance() : f.initial;
    f.git(f.host, '-c', 'user.name=CI test', '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty', '-m', 'host commit');
    const hostSha = f.git(f.host, 'rev-parse', 'HEAD');
    assertNotDeployed(f, f.run(target), divergent ? /fast-forward/i : /does not match the tested commit/);
    assert.equal(f.git(f.host, 'rev-parse', 'HEAD'), hostSha);
  });
}

test('fails closed if the remote cannot be fetched', (t) => {
  const f = fixture(t);
  f.git(f.host, 'remote', 'set-url', 'origin', join(f.root, 'missing-origin'));
  assertNotDeployed(f, f.run(), /does not appear to be a git repository/);
});

test('a failed Docker build fails deployment before restarting the backend', (t) => {
  const f = fixture(t);
  const result = f.run(f.initial, { TEST_BUILD_EXIT: '42' });
  assert.equal(result.status, 42, result.stderr);
  assert.doesNotMatch(f.calls(), /force-recreate/);
});

test('migration failures stop the release before restarting the backend', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.host, '.env'), 'DATABASE_URL=postgresql://test.invalid/example\n');
  const result = f.run(f.initial, { TEST_MIGRATION_EXIT: '43' });
  assert.equal(result.status, 43, result.stderr);
  assert.match(f.calls(), /npm run db:migrate/);
  assert.doesNotMatch(f.calls(), /force-recreate/);
});

test('unhealthy releases fail with diagnostics after bounded readiness attempts', (t) => {
  const f = fixture(t);
  const result = f.run(f.initial, { TEST_HEALTH_EXIT: '28', TEST_BACKEND_RUNNING: '0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Backend did not become healthy after 30 attempts/);
  assert.match(f.calls(), /compose logs --tail 50 backend/);
  assert.doesNotMatch(result.stdout, /Deploy complete/);
  const probes = readFileSync(join(f.host, 'health-calls.txt'), 'utf8').trim().split('\n');
  assert.equal(probes.length, 30);
  assert.ok(probes.every((probe) => probe.includes('--connect-timeout 2 --max-time 5')));
  assert.doesNotMatch(f.calls(), /rollback/);
  assert.doesNotMatch(f.calls(), /prune/);
});

test('an unhealthy release restores the previous image and still fails', (t) => {
  const f = fixture(t);
  const result = f.run(f.initial, { TEST_HEALTH_EXIT: '28', TEST_ROLLBACK_HEALTHY: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Rolling back to the previous backend image/);
  assert.match(result.stderr, /Previous backend image restored and healthy/);
  const calls = f.calls();
  assert.match(calls, /image tag summitsafe-backend:rollback summitsafe-backend:latest\ncompose up -d --force-recreate --no-deps backend\n?$/);
  assert.doesNotMatch(calls, /health-monitor|prune/);
  assert.doesNotMatch(result.stdout, /Deploy complete/);
});

test('rollback targets the running backend image, not a latest tag from a failed release', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.host, '.env'), 'DATABASE_URL=postgresql://test.invalid/example\n');
  // A release builds a new :latest, then fails before restarting the backend.
  assert.equal(f.run(f.initial, { TEST_MIGRATION_EXIT: '43' }).status, 43);
  const result = f.run(f.initial, { TEST_HEALTH_EXIT: '28', TEST_ROLLBACK_HEALTHY: '1' });
  assert.equal(result.status, 1, result.stderr);
  const snapshots = f.calls().split('\n').filter((call) => call.endsWith(' summitsafe-backend:rollback'));
  assert.deepEqual(snapshots, [
    'image tag sha256:running-image summitsafe-backend:rollback',
    'image tag sha256:running-image summitsafe-backend:rollback',
  ]);
});

test('reports when the rollback image is also unhealthy', (t) => {
  const f = fixture(t);
  const result = f.run(f.initial, { TEST_HEALTH_EXIT: '28' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Rollback image is also unhealthy/);
  const probes = readFileSync(join(f.host, 'health-calls.txt'), 'utf8').trim().split('\n');
  assert.equal(probes.length, 60);
});

test('--no-build releases do not replace the rollback image', (t) => {
  const f = fixture(t);
  const result = spawnSync('bash', [join(f.host, 'scripts', 'deploy.sh'), '--no-pull', '--no-build', '--no-nginx'], {
    cwd: f.host, env: { ...f.env, DEPLOY_SHA: f.initial }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(f.calls(), /image tag|compose build/);
});

test('rejects a competing release and releases the lock when the owner exits', { timeout: 10_000 }, async (t) => {
  const f = fixture(t);
  const holder = spawn('bash', ['-c', 'exec 9>"$SUMMITSAFE_APP_DIR/.git/summitsafe-deploy.lock"; flock -n 9 || exit; echo locked; read -r release'], {
    env: f.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => holder.kill());
  const [ready] = await once(holder.stdout, 'data');
  assert.match(ready.toString(), /locked/);
  assertNotDeployed(f, f.run(), /Another deployment is already running/);
  const exited = once(holder, 'exit');
  holder.stdin.end('release\n');
  await exited;
  assert.equal(f.run().status, 0);
});

test('skips the MCP server when mcp/.env is not configured', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MCP server skipped/);
  assert.doesNotMatch(f.calls(), /conditions-mcp/);
});

test('releases the MCP server after the healthy backend, snapshotting its running image', (t) => {
  const f = fixture(t);
  f.enableMcp();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deploy complete/);
  const calls = f.calls();
  assert.match(calls, /compose up -d --force-recreate --no-deps backend\n[^]*--project-name conditions-mcp --file \S+\/mcp\/compose\.yaml ps --quiet conditions-mcp\ninspect --format \{\{\.Image\}\} running-mcp-container\nimage tag sha256:running-mcp-image conditions-mcp:rollback\n\S.* build --pull conditions-mcp\n\S.* up -d conditions-mcp\n/);
  assert.doesNotMatch(calls, /up -d --force-recreate conditions-mcp/);
});

test('a failed MCP build fails the release without touching the running MCP container', (t) => {
  const f = fixture(t);
  f.enableMcp();
  const result = f.run(f.initial, { TEST_MCP_BUILD_EXIT: '44' });
  assert.equal(result.status, 44, result.stderr);
  assert.doesNotMatch(f.calls(), /up -d conditions-mcp/);
});

test('an unhealthy MCP release restores the previous MCP image and keeps the new backend', (t) => {
  const f = fixture(t);
  f.enableMcp();
  const result = f.run(f.initial, { TEST_MCP_HEALTH_EXIT: '7', TEST_MCP_ROLLBACK_HEALTHY: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /MCP server did not become healthy after 30 attempts/);
  assert.match(result.stderr, /Previous MCP image restored and healthy/);
  const calls = f.calls();
  assert.match(calls, /image tag conditions-mcp:rollback conditions-mcp:latest\n\S.* up -d --force-recreate conditions-mcp\n/);
  assert.doesNotMatch(calls, /summitsafe-backend:rollback summitsafe-backend:latest/);
  assert.doesNotMatch(result.stdout, /Deploy complete/);
});

test('reports when the MCP rollback image is also unhealthy', (t) => {
  const f = fixture(t);
  f.enableMcp();
  const result = f.run(f.initial, { TEST_MCP_HEALTH_EXIT: '7' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Rollback MCP image is also unhealthy/);
  const probes = readFileSync(join(f.host, 'mcp-health-calls.txt'), 'utf8').trim().split('\n');
  assert.equal(probes.length, 60);
});

test('a first MCP release has no rollback image to restore', (t) => {
  const f = fixture(t);
  f.enableMcp();
  const result = f.run(f.initial, { TEST_MCP_HEALTH_EXIT: '7', TEST_MCP_RUNNING: '0' });
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(f.calls(), /conditions-mcp:rollback/);
});

test('--no-build releases start the MCP server without rebuilding it', (t) => {
  const f = fixture(t);
  f.enableMcp();
  const result = spawnSync('bash', [join(f.host, 'scripts', 'deploy.sh'), '--no-pull', '--no-build', '--no-nginx'], {
    cwd: f.host, env: { ...f.env, DEPLOY_SHA: f.initial }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.calls(), /up -d conditions-mcp/);
  assert.doesNotMatch(f.calls(), /image tag|build --pull/);
});

// Commits files to origin and returns the new SHA.
function commit(f, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(f.origin, path)), { recursive: true });
    writeFileSync(join(f.origin, path), content);
  }
  f.git(f.origin, 'add', '--', ...Object.keys(files));
  f.git(f.origin, 'commit', '-m', `change ${Object.keys(files).join(' ')}`);
  return f.git(f.origin, 'rev-parse', 'HEAD');
}

// A committed MCP server, as in production, with its ignored .env on the host.
function trackMcp(f) {
  const sha = commit(f, { '.gitignore': '.env\n', 'mcp/compose.yaml': '# test fixture\n' });
  mkdirSync(join(f.host, 'mcp'), { recursive: true });
  writeFileSync(join(f.host, 'mcp', '.env'), '# no secrets in tests\n');
  return sha;
}

const builds = (f, name) => f.calls().split('\n').filter((call) => call.endsWith(`build --pull ${name}`)).length;

test('a release that touches neither the backend nor MCP keeps both running', (t) => {
  const f = fixture(t);
  assert.equal(f.run(trackMcp(f)).status, 0);
  assert.equal(builds(f, 'backend'), 1);
  assert.equal(builds(f, 'conditions-mcp'), 1);
  const restarts = f.calls().split('\n').filter((call) => call.includes('up -d')).length;
  const result = f.run(f.advance());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Backend unchanged since [0-9a-f]{40}; keeping the running backend/);
  assert.match(result.stdout, /MCP server unchanged since [0-9a-f]{40}; keeping the running server/);
  assert.match(result.stdout, /Deploy complete/);
  assert.equal(builds(f, 'backend'), 1);
  assert.equal(builds(f, 'conditions-mcp'), 1);
  assert.equal(f.calls().split('\n').filter((call) => call.includes('up -d')).length, restarts);
});

test('a backend change rebuilds the backend and keeps the unchanged MCP server', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.host, '.env'), 'DATABASE_URL=postgresql://test.invalid/example\n');
  assert.equal(f.run(trackMcp(f)).status, 0);
  const result = f.run(commit(f, { 'backend/index.js': 'changed\n' }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(builds(f, 'backend'), 2);
  assert.equal(f.calls().split('\n').filter((call) => call.endsWith('npm run db:migrate')).length, 2);
  assert.equal(builds(f, 'conditions-mcp'), 1);
});

test('an MCP change rebuilds only the MCP server', (t) => {
  const f = fixture(t);
  assert.equal(f.run(trackMcp(f)).status, 0);
  const result = f.run(commit(f, { 'mcp/src/index.js': 'changed\n' }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(builds(f, 'backend'), 1);
  assert.equal(builds(f, 'conditions-mcp'), 2);
});

test('a docker-compose.yml change rebuilds the backend', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(f.run(commit(f, { 'docker-compose.yml': '# changed\n' })).status, 0);
  assert.equal(builds(f, 'backend'), 2);
});

test('a rolled-back release is built again by the next one', (t) => {
  const f = fixture(t);
  const failed = commit(f, { 'backend/index.js': 'broken\n' });
  assert.equal(f.run(failed, { TEST_HEALTH_EXIT: '28', TEST_ROLLBACK_HEALTHY: '1' }).status, 1);
  const result = f.run(f.advance());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(builds(f, 'backend'), 2);
});

test('an unchanged backend that is not running is started again', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const result = f.run(f.advance(), { TEST_BACKEND_RUNNING: '0' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(builds(f, 'backend'), 2);
});

test('an image built with uncommitted files is rebuilt by the next release', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.host, 'backend'));
  writeFileSync(join(f.host, 'backend', 'hotfix.js'), 'untracked\n');
  assert.equal(f.run().status, 0);
  rmSync(join(f.host, 'backend', 'hotfix.js'));
  assert.equal(f.run(f.advance()).status, 0);
  assert.equal(builds(f, 'backend'), 2);
});

test('manual releases rebuild unchanged images', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const result = spawnSync('bash', [join(f.host, 'scripts', 'deploy.sh'), '--no-pull', '--no-nginx'], {
    cwd: f.host, env: { ...f.env, DEPLOY_SHA: f.initial }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(builds(f, 'backend'), 2);
});

test('a failed health monitor start is retried by the next release', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.host, '.env'), 'RESEND_API_KEY=x\nEMAIL_FROM=x@example.invalid\nAPP_BASE_URL=https://example.invalid\n');
  assert.equal(f.run(f.initial, { TEST_MONITOR_EXIT: '45' }).status, 45);
  const result = f.run(f.advance());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(builds(f, 'backend'), 2);
  assert.equal(f.calls().split('\n').filter((call) => call.endsWith('--no-deps health-monitor')).length, 2);
});
