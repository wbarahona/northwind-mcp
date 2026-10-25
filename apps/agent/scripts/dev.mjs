// `pnpm dev` for the agent: recompiles on change and restarts the server on port 5174, with
// settings from the repo's .env (shell variables win). The page's Vite dev server on 5173
// proxies /api to it.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');
const children = [];

// The repo's .env, read here rather than with node --env-file: under --watch, Node watches
// the env file's whole folder (the repo root), so every change anywhere (git, turbo's cache,
// other apps' builds) would restart the agent and cut off a chat in progress.
const envFile = new URL('../../../.env', import.meta.url);
const dotenv = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, 'utf8'))
  : {};

const tsc = spawn(
  process.execPath,
  [tscBin, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
children.push(tsc);

let server;
tsc.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  // Start the server after the first successful compile; node --watch restarts it after that.
  if (!server && /Found 0 errors/.test(chunk.toString())) {
    server = spawn(process.execPath, ['--watch-path=dist', 'dist/index.js'], {
      stdio: 'inherit',
      // Shell variables win over .env. .env's PORT is the API's (3000); the agent's dev
      // port is 5174 unless AGENT_PORT says otherwise.
      env: {
        ...dotenv,
        ...process.env,
        PORT: process.env.AGENT_PORT ?? '5174',
      },
    });
    children.push(server);
  }
});

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
