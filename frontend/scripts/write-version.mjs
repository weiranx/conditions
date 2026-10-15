// Stamps the build with what it was built from, in dist/version.json. The deploy
// smoke test compares the live frontendTree with the released commit's, so a
// frontend release that never reached production fails the deploy instead of
// leaving an old build live.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

const version = {
  commit: git('rev-parse', 'HEAD'),
  // frontend/ as a git tree (the build runs in frontend/): the same for every
  // commit that leaves frontend/ alone, which is when the deploy skips the build.
  frontendTree: git('rev-parse', 'HEAD:./'),
  builtAt: new Date().toISOString(),
};

await writeFile('dist/version.json', `${JSON.stringify(version)}\n`);
