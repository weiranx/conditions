import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
if [ "$*" = 'compose run --rm --no-deps backend npm run db:migrate' ]; then
  exit "$TEST_MIGRATION_EXIT"
fi
`);
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SUMMITSAFE_APP_DIR/health-calls.txt"
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
  const result = f.run(f.initial, { TEST_HEALTH_EXIT: '28' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Backend did not become healthy after 30 attempts/);
  assert.match(f.calls(), /compose logs --tail 50 backend/);
  assert.doesNotMatch(result.stdout, /Deploy complete/);
  const probes = readFileSync(join(f.host, 'health-calls.txt'), 'utf8').trim().split('\n');
  assert.equal(probes.length, 30);
  assert.ok(probes.every((probe) => probe.includes('--connect-timeout 2 --max-time 5')));
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
