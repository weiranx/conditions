import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const provisionServer = fileURLToPath(new URL('../provision-server.sh', import.meta.url));
const setupNginx = fileURLToPath(new URL('../setup-nginx.sh', import.meta.url));
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const CI_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyOnlyForProvisioningTests github-actions';

function stub(bin, name, body) {
  writeFileSync(join(bin, name), `#!/usr/bin/env bash\nprintf '%s %s\\n' ${name} "$*" >> "$TEST_ROOT/calls.txt"\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
}

// Runs the real provision-server.sh against a local repository, with every
// root-only or networked command replaced by a stub that records its call.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'conditions-provision-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin');
  const bin = join(root, 'bin');
  const home = join(root, 'home-deploy');
  const appDir = join(root, 'opt', 'summitsafe');
  mkdirSync(bin);
  mkdirSync(join(root, 'opt'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: origin, env: gitEnv, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  mkdirSync(join(origin, 'scripts'), { recursive: true });
  mkdirSync(join(origin, 'backend'));
  mkdirSync(join(origin, 'mcp'));
  writeFileSync(join(origin, 'backend', '.env.example'), 'NODE_ENV=production\nCORS_ORIGIN=\nAPP_BASE_URL=https://conditions.example.com\nOBJECTIVE_WATCH_CRON_SECRET=\n');
  writeFileSync(join(origin, 'mcp', '.env.example'), 'CONDITIONS_API_URL=https://apivps.conditions.weiranxiong.com\nMCP_PUBLIC_URL=https://apivps.conditions.weiranxiong.com\n');
  const scripts = {
    'setup-nginx.sh': '',
    // Mirrors deploy-postgres.sh's first-run effect on .env.
    'deploy-postgres.sh': 'echo DATABASE_URL=postgresql://generated@postgres:5432/summitsafe >> .env',
    'deploy.sh': '',
  };
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(origin, 'scripts', name), `#!/usr/bin/env bash\nprintf '%s %s (cwd %s)\\n' ${name} "$*" "$PWD" >> "$TEST_ROOT/calls.txt"\n${body}\n`);
    chmodSync(join(origin, 'scripts', name), 0o755);
  }
  writeFileSync(join(origin, 'scripts', 'smoke-test.mjs'), '');
  git('init', '--initial-branch=main');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-m', 'initial');

  for (const name of ['apt-get', 'systemctl', 'adduser', 'usermod', 'chown', 'nginx', 'sleep']) stub(bin, name, 'exit 0');
  stub(bin, 'id', '[ "$1" = -u ] && echo 0; exit 0');
  stub(bin, 'ufw', '[ "$1" = status ] && echo "Status: $(cat "$TEST_ROOT/ufw" 2>/dev/null || echo inactive)"; exit 0');
  stub(bin, 'ss', 'cat "$TEST_ROOT/listeners" 2>/dev/null; exit 0');
  stub(bin, 'sshd', 'echo "port $(cat "$TEST_ROOT/ssh-port" 2>/dev/null || echo 22)"');
  stub(bin, 'docker', 'exit 0');
  stub(bin, 'getent', `case "$1" in
  passwd) echo "$2:x:1000:1000::$TEST_HOME:/bin/bash" ;;
  ahostsv4) [ -f "$TEST_ROOT/dns" ] && echo "$(cat "$TEST_ROOT/dns") STREAM $2" ;;
esac
exit 0`);
  // Ownership needs root; the rest of install's behavior is kept.
  stub(bin, 'install', `args=()
while [ "$#" -gt 0 ]; do
  case "$1" in -o|-g) shift ;; *) args+=("$1") ;; esac
  shift
done
exec /usr/bin/install "\${args[@]}"`);
  stub(bin, 'runuser', 'while [ "$1" != -- ]; do shift; done; shift; exec "$@"');
  stub(bin, 'ssh-keygen', 'echo "256 SHA256:testfingerprint root@host (ED25519)"');
  // Cloudflare API: the zone is example.test; the record comes from $TEST_ROOT/cf-record.
  stub(bin, 'curl', `case "$*" in
  *zones?name=example.test*) echo '{"result":[{"id":"zone1"}]}' ;;
  *zones?name=*) echo '{"result":[]}' ;;
  *'-X POST'*|*'-X PATCH'*) echo "$TEST_PUBLIC_IP" > "$TEST_ROOT/dns"; echo '{"success":true}' ;;
  *dns_records?type=A*) cat "$TEST_ROOT/cf-record" 2>/dev/null || echo '{"result":[]}' ;;
  *) exit 22 ;;
esac`);

  const env = {
    ...gitEnv, PATH: `${bin}:${process.env.PATH}`, TEST_ROOT: root, TEST_HOME: home,
    TEST_PUBLIC_IP: '203.0.113.10',
  };
  delete env.CLOUDFLARE_API_TOKEN;
  const baseArgs = [
    '--domain', 'api.example.test', '--frontend-origin', 'https://app.example.test',
    '--email', 'ops@example.test', '--ci-public-key', CI_KEY,
    '--repo', origin, '--app-dir', appDir, '--public-ip', '203.0.113.10',
  ];
  return {
    root, appDir, home,
    pointDns(ip) { writeFileSync(join(root, 'dns'), ip); },
    write(name, content) { writeFileSync(join(root, name), content); },
    run(extraArgs = [], extraEnv = {}) {
      // Piped like `ssh … bash -s`, so the /dev/null stdin guard is exercised.
      return spawnSync('bash', ['-s', '--', ...baseArgs, ...extraArgs], {
        input: readFileSync(provisionServer), env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 20_000,
      });
    },
    calls() {
      const file = join(root, 'calls.txt');
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    },
    read(path) { return readFileSync(join(appDir, path), 'utf8'); },
  };
}

test('provisions a fresh server end to end', (t) => {
  const f = fixture(t);
  f.pointDns('203.0.113.10');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const env = f.read('.env');
  assert.match(env, /^CORS_ORIGIN=https:\/\/app\.example\.test$/m);
  assert.match(env, /^APP_BASE_URL=https:\/\/app\.example\.test$/m);
  assert.match(env, /^OBJECTIVE_WATCH_CRON_SECRET=[0-9a-f]{64}$/m);
  assert.doesNotMatch(env, /MCP_PUBLIC_URL/, 'the backend refuses MCP_PUBLIC_URL without OAuth client settings');
  assert.match(f.read('mcp/.env'), /^CONDITIONS_API_URL=https:\/\/api\.example\.test\nMCP_PUBLIC_URL=https:\/\/api\.example\.test\n$/);
  assert.equal(readFileSync(join(f.home, '.ssh', 'authorized_keys'), 'utf8'), `${CI_KEY}\n`);

  const calls = f.calls();
  const order = ['apt-get install', 'ufw --force enable', 'usermod -aG docker deploy', 'setup-nginx.sh --domain api.example.test --email ops@example.test (cwd',
    'deploy-postgres.sh', `deploy.sh --no-nginx (cwd ${f.appDir})`, 'nginx -t', 'docker run'];
  let at = 0;
  for (const step of order) {
    const found = calls.indexOf(step, at);
    assert.ok(found >= at, `expected "${step}" after position ${at}:\n${calls}`);
    at = found;
  }
  assert.match(calls, /docker run .*smoke-test\.mjs.* --api https:\/\/api\.example\.test --no-safety --no-mcp/);
  assert.match(result.stdout, /DO_SSH_HOST=203\.0\.113\.10/);
  assert.match(result.stdout, /DO_SSH_FINGERPRINT=SHA256:testfingerprint/);
  assert.match(result.stdout, /MCP_PUBLIC_URL=https:\/\/api\.example\.test, MCP_FRONTEND_ORIGIN=https:\/\/app\.example\.test/);
});

test('a rerun keeps existing secrets, keys and settings', (t) => {
  const f = fixture(t);
  f.pointDns('203.0.113.10');
  assert.equal(f.run().status, 0);
  const envPath = join(f.appDir, '.env');
  writeFileSync(envPath, f.read('.env').replace(/^CORS_ORIGIN=.*$/m, 'CORS_ORIGIN=https://app.example.test,https://www.example.test'));
  writeFileSync(join(f.appDir, 'mcp', '.env'), 'CONDITIONS_API_URL=https://custom.example.test\n');
  const before = f.read('.env');
  writeFileSync(join(f.root, 'calls.txt'), '');

  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.read('.env'), before);
  assert.equal(f.read('mcp/.env'), 'CONDITIONS_API_URL=https://custom.example.test\n');
  assert.equal(readFileSync(join(f.home, '.ssh', 'authorized_keys'), 'utf8'), `${CI_KEY}\n`);
  assert.doesNotMatch(f.calls(), /deploy-postgres\.sh|git clone/);
  assert.match(f.calls(), /deploy\.sh --no-nginx/);
});

test('stops before TLS when DNS does not point at the droplet', (t) => {
  const f = fixture(t);
  f.pointDns('198.51.100.7');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /api\.example\.test resolves to '198\.51\.100\.7 ', not 203\.0\.113\.10/);
  assert.match(result.stderr, /Create an A record 'api\.example\.test → 203\.0\.113\.10' \(DNS only/);
  assert.doesNotMatch(f.calls(), /setup-nginx\.sh|deploy\.sh|deploy-postgres/);
});

test('creates a DNS-only Cloudflare record, then waits for it to resolve', (t) => {
  const f = fixture(t);
  const result = f.run([], { CLOUDFLARE_API_TOKEN: 'test-token' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /created Cloudflare A record api\.example\.test → 203\.0\.113\.10 \(zone example\.test\)/);
  const post = f.calls().split('\n').find((line) => line.includes('-X POST'));
  assert.match(post, /zones\/zone1\/dns_records$/);
  assert.match(post, /"proxied":false/);
  assert.match(post, /"content":"203\.0\.113\.10"/);
  assert.doesNotMatch(f.calls(), /test-token/, 'the token must never appear in a command line');
});

test('moves a proxied or stale Cloudflare record to this droplet', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'cf-record'), '{"result":[{"id":"rec1","content":"198.51.100.7","proxied":true}]}');
  const result = f.run([], { CLOUDFLARE_API_TOKEN: 'test-token' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(f.calls(), /-X PATCH .*zones\/zone1\/dns_records\/rec1/);
});

test('--no-mcp leaves the MCP server unconfigured', (t) => {
  const f = fixture(t);
  f.pointDns('203.0.113.10');
  const result = f.run(['--no-mcp']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(f.appDir, 'mcp', '.env')), false);
  assert.match(f.calls(), /setup-nginx\.sh --domain api\.example\.test --email ops@example\.test --no-mcp/);
  assert.doesNotMatch(result.stdout, /MCP_PUBLIC_URL=/);
});

test('allows a custom SSH port before enabling the firewall', (t) => {
  const f = fixture(t);
  f.pointDns('203.0.113.10');
  f.write('ssh-port', '2222');
  f.write('listeners', 'LISTEN 0 128 0.0.0.0:2222 0.0.0.0:*\nLISTEN 0 511 127.0.0.1:3001 0.0.0.0:*\n');
  assert.equal(f.run().status, 0);
  const calls = f.calls();
  assert.ok(calls.indexOf('ufw allow 2222/tcp') < calls.indexOf('ufw --force enable'), calls);
  assert.doesNotMatch(calls, /ufw allow 22\/tcp/);
});

test('leaves an inactive firewall off when other services listen publicly', (t) => {
  const f = fixture(t);
  f.pointDns('203.0.113.10');
  f.write('listeners', 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\nLISTEN 0 128 0.0.0.0:8080 0.0.0.0:*\nLISTEN 0 128 [::]:9000 [::]:*\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /ufw left disabled; ports 8080 9000 are listening publicly/);
  assert.doesNotMatch(f.calls(), /ufw --force enable/);
});

test('only adds rules to an already active firewall', (t) => {
  const f = fixture(t);
  f.pointDns('203.0.113.10');
  f.write('ufw', 'active');
  assert.equal(f.run().status, 0);
  assert.doesNotMatch(f.calls(), /ufw --force enable/);
  assert.match(f.calls(), /ufw allow 443\/tcp/);
});

for (const [args, pattern] of [
  [['--frontend-origin', 'https://app.example.test/'], /--frontend-origin must be an HTTPS origin/],
  [['--frontend-origin', 'http://app.example.test'], /--frontend-origin must be an HTTPS origin/],
  [['--domain', 'not a domain'], /--domain must be a hostname/],
  [['--ci-public-key', 'not-a-key'], /not an OpenSSH public key/],
]) {
  test(`rejects ${args.join(' ')}`, (t) => {
    const f = fixture(t);
    f.pointDns('203.0.113.10');
    const result = f.run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, pattern);
  });
}

function renderNginx(...args) {
  const result = spawnSync('bash', [setupNginx, '--domain', 'api.example.test', '--dry-run', ...args], {
    env: { ...process.env, SUMMITSAFE_NGINX_SITE: '/nonexistent/summitsafe' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('nginx site routes the API, MCP and MCP OAuth aliases', () => {
  const site = renderNginx();
  assert.match(site, /ssl_certificate +\/etc\/letsencrypt\/live\/api\.example\.test\/fullchain\.pem;/);
  assert.match(site, /location \^~ \/mcp \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:8104;\n\s+proxy_buffering off;/);
  assert.match(site, /location \^~ \/\.well-known\/oauth-protected-resource \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:8104;/);
  assert.match(site, /location = \/\.well-known\/oauth-authorization-server \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:3001\/api\/auth\/mcp\/metadata;/);
  assert.match(site, /location = \/oauth\/token \{\n\s+proxy_pass http:\/\/127\.0\.0\.1:3001\/api\/auth\/mcp\/token;/);
  assert.match(site, /location \/\.well-known\/acme-challenge\/ \{\n\s+root \/var\/www\/certbot;/);
  assert.match(site, /return 301 https:\/\/\$host\$request_uri;/);
  assert.equal((site.match(/access_log off;/g) ?? []).length, 6);
});

test('nginx site without MCP serves only the API', () => {
  const site = renderNginx('--no-mcp');
  assert.doesNotMatch(site, /8104|oauth|\/mcp/);
  assert.match(site, /location \/api\/ \{/);
});

test('nginx setup rejects a malformed domain before touching anything', () => {
  const result = spawnSync('bash', [setupNginx, '--domain', 'bad domain;', '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--domain must be a hostname/);
});
