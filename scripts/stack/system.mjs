// Facts about this machine, Docker and the running stack. Every probe works the same on
// macOS, Linux and Windows (Node's own os/fs/net, plus the docker CLI); a probe that can't
// answer returns null rather than failing.
import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { connect } from 'node:net';
import os from 'node:os';

/** Runs a command and returns its trimmed output, or null if it is missing or fails. */
export function run(command, args, { cwd, env, timeout = 20_000 } = {}) {
  try {
    return execFileSync(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    }).trim();
  } catch {
    return null;
  }
}

const gb = (bytes) => Math.round(bytes / 1024 ** 3);

export function machineFacts() {
  const platform = os.platform();
  const arch = os.arch();
  let freeDiskGb = null;
  try {
    const fs = statfsSync(os.homedir());
    freeDiskGb = gb(fs.bavail * fs.bsize);
  } catch {
    // Unknown; the check says so.
  }
  const nvidia = run(
    'nvidia-smi',
    ['--query-gpu=name', '--format=csv,noheader'],
    { timeout: 5000 },
  );
  return {
    platform,
    arch,
    wsl: platform === 'linux' && /microsoft/i.test(os.release()),
    cpu: os.cpus()[0]?.model?.trim() ?? arch,
    memoryGb: gb(os.totalmem()),
    freeDiskGb,
    appleSilicon: platform === 'darwin' && arch === 'arm64',
    nvidia: nvidia ? nvidia.split('\n')[0].trim() : null,
  };
}

async function reachable(url, timeout = 2000) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeout) })).ok;
  } catch {
    return false;
  }
}

export async function dockerFacts() {
  const installed = run('docker', ['--version']) !== null;
  if (!installed) return { installed: false };
  const info = run('docker', ['info', '--format', '{{json .}}']);
  if (!info) return { installed: true, running: false };

  let parsed = {};
  try {
    parsed = JSON.parse(info);
  } catch {
    // Older formats; the fields below stay unknown.
  }
  const platformName =
    run('docker', ['version', '--format', '{{.Server.Platform.Name}}']) ?? '';
  const desktop = platformName.match(/Docker Desktop ([0-9.]+)/)?.[1] ?? null;
  const modelRunnerInstalled = run('docker', ['model', 'version']) !== null;
  return {
    installed: true,
    running: true,
    desktopVersion: desktop,
    engineVersion: parsed.ServerVersion ?? null,
    composeVersion:
      run('docker', ['compose', 'version', '--short'])?.replace(/^v/, '') ??
      null,
    vmMemoryGb: parsed.MemTotal ? gb(parsed.MemTotal) : null,
    nvidiaRuntime: Boolean(parsed.Runtimes && 'nvidia' in parsed.Runtimes),
    modelRunner: {
      installed: modelRunnerInstalled,
      running:
        modelRunnerInstalled &&
        (run('docker', ['model', 'status']) ?? '').includes('is running'),
      hostTcp:
        modelRunnerInstalled &&
        (await reachable('http://localhost:12434/engines/v1/models')),
    },
  };
}

/** Is something listening on this port on this machine? (A connection attempt, not lsof.) */
export function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(700, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Host ports published by this project's running containers. */
export function stackPorts(cwd) {
  const out = run('docker', ['compose', 'ps', '--format', 'json'], { cwd });
  if (!out) return new Set();
  // One JSON object per line (newer Compose) or one array (older).
  const rows = out.startsWith('[')
    ? JSON.parse(out)
    : out
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
  return new Set(
    rows
      .flatMap((row) => (row.Publishers ?? []).map((p) => p.PublishedPort))
      .filter(Boolean),
  );
}

/** Orders in the stack's database, or null when Mongo isn't up. */
export function orderCount(cwd, db = 'northwind') {
  const out = run(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'mongo',
      'mongosh',
      '--quiet',
      db,
      '--eval',
      'db.orders.estimatedDocumentCount()',
    ],
    { cwd },
  );
  const count = Number(out?.split('\n').at(-1));
  return Number.isInteger(count) ? count : null;
}

/** Addresses others on the network can use: the Mac's .local name, then IPv4 addresses. */
export function networkAddresses() {
  const names = [];
  if (os.platform() === 'darwin') {
    const local = run('scutil', ['--get', 'LocalHostName']);
    if (local) names.push(`${local}.local`);
  }
  for (const list of Object.values(os.networkInterfaces())) {
    for (const address of list ?? []) {
      if (address.family === 'IPv4' && !address.internal)
        names.push(address.address);
    }
  }
  return names;
}
