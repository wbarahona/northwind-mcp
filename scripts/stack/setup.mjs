// pnpm stack:setup: from a fresh checkout to a running chat. Checks, settings, the model server,
// images, database, stack. Safe to re-run: it keeps .env (adding only what is missing) and
// never reseeds a database that already has data.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { evaluate } from './checks.mjs';
import { newEnvFromExample, readEnv, setEnv } from './env-file.mjs';
import {
  composeFileFor,
  PROVIDER_NAMES,
  PROVIDERS,
  providerOf,
} from './providers.mjs';
import {
  dockerFacts,
  machineFacts,
  networkAddresses,
  orderCount,
  portInUse,
  stackPorts,
} from './system.mjs';

const CONTEXT_SIZE = '16384'; // the same as compose.model-runner.yml and compose.ollama.yml

export class SetupError extends Error {}

/** The stack's host ports, from .env. */
export function stackPortList(env, provider) {
  const ports = [
    env.AGENT_PORT || 5173,
    env.API_PORT || 3000,
    env.MONGO_PORT || 27017,
  ];
  if (provider === 'ollama') ports.push(env.OLLAMA_PORT || 11434);
  return ports.map(Number);
}

export async function collectFacts(root, env, envExists, requested) {
  const machine = machineFacts();
  const docker = await dockerFacts();
  const provider = requested?.provider ?? (envExists ? providerOf(env) : null);
  const inStack = docker.running ? stackPorts(root) : new Set();
  const ports = await Promise.all(
    stackPortList(env, provider ?? 'docker-model-runner').map(async (port) => ({
      port,
      inUse: await portInUse(port),
      byStack: inStack.has(port),
    })),
  );
  return {
    machine,
    docker,
    env,
    envExists,
    ports,
    ...(requested && { requested }),
  };
}

export async function setup(root, opts, ui) {
  const { step, note, command, printChecks } = ui;
  const dryRun = Boolean(opts.dryRun);
  /** Runs a command for all to see, or only shows it with --dry-run. */
  const exec = (cmd, args, env) => {
    command([cmd, ...args].join(' '));
    if (dryRun) return true;
    return (
      spawnSync(cmd, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, ...env },
      }).status === 0
    );
  };

  // ------------------------------------------------------------------ 1. checks
  const envPath = join(root, '.env');
  const envExists = existsSync(envPath);
  let envText = envExists
    ? readFileSync(envPath, 'utf8')
    : newEnvFromExample(readFileSync(join(root, '.env.example'), 'utf8'));
  let env = readEnv(envText);

  step('Checking this machine');
  if (opts.provider && !PROVIDER_NAMES.includes(opts.provider)) {
    throw new SetupError(
      `Unknown provider "${opts.provider}": use one of ${PROVIDER_NAMES.join(', ')}`,
    );
  }
  const requested = opts.provider
    ? { provider: opts.provider, nvidia: opts.nvidia }
    : undefined;
  const facts = await collectFacts(root, env, envExists, requested);
  const verdict = evaluate(facts);
  printChecks(verdict.sections);
  if (verdict.failed)
    throw new SetupError('Fix the ✗ items above, then run setup again.');

  // ------------------------------------------------------------------ 2. settings
  step('Settings (.env)');
  note(
    envExists
      ? '.env exists: keeping it, adding only what is missing'
      : 'creating .env from .env.example, with a new random API key',
  );

  const before = envExists ? providerOf(env) : null;
  let provider =
    opts.provider ??
    (env.LLM_PROVIDER?.trim()
      ? before
      : envExists
        ? 'docker-model-runner'
        : null);
  if (!provider)
    provider = await askProvider(verdict.choice.suggestion, opts.yes);
  if (!PROVIDER_NAMES.includes(provider))
    throw new SetupError(
      `Unknown provider "${provider}": use one of ${PROVIDER_NAMES.join(', ')}`,
    );
  const p = PROVIDERS[provider];
  const nvidia =
    provider === 'ollama' &&
    (opts.nvidia ??
      ((env.COMPOSE_FILE ?? '').includes('compose.ollama-nvidia.yml') ||
        Boolean(verdict.choice.suggestion.nvidia)));

  const updates = {
    LLM_PROVIDER: provider,
    COMPOSE_FILE: composeFileFor(provider, { nvidia, separator: delimiter }),
  };
  // The model: the one asked for; else keep .env's unless the provider changes (model names
  // differ between servers); a new .env names the default, as a starting point to edit.
  if (opts.model) updates.LLM_MODEL = opts.model;
  else if ((before && before !== provider) || !envExists) {
    if (p.defaultModel) updates.LLM_MODEL = p.defaultModel;
  }
  if (provider === 'openai-compatible') {
    const url = opts.url ?? env.STACK_LLM_URL?.trim();
    const model = opts.model ?? env.LLM_MODEL?.trim();
    if (!url || !model) {
      throw new SetupError(
        'An OpenAI-compatible server needs --url (as seen from a container, e.g. http://host.docker.internal:1234/v1/) and --model.',
      );
    }
    updates.STACK_LLM_URL = url;
    updates.LLM_MODEL = model;
  }

  const result = setEnv(envText, updates);
  envText = result.text;
  env = readEnv(envText);
  for (const change of result.changes)
    note(`${dryRun ? 'would set' : 'set'} ${change}`);
  if (result.changes.length === 0) note('nothing to change');
  if (!dryRun && (result.changes.length || !envExists))
    writeFileSync(envPath, envText);
  const model = env.LLM_MODEL?.trim() || p.defaultModel;
  note(
    `model server: ${p.label}${nvidia ? ' (NVIDIA GPU)' : ''}; model: ${model}`,
  );
  // Compose reads .env itself; passing the settings too keeps --dry-run's commands honest.
  const composeEnv = {
    COMPOSE_FILE: env.COMPOSE_FILE,
    ...(env.LLM_MODEL && { LLM_MODEL: env.LLM_MODEL }),
  };

  // ------------------------------------------------------------------ 3. model server
  if (provider === 'docker-model-runner') {
    step('Docker Model Runner');
    const mr = facts.docker.modelRunner;
    if (mr.running && mr.hostTcp) {
      note('on, with access from this machine on port 12434');
    } else if (facts.docker.desktopVersion) {
      note(
        'Turning it on, with access from this machine on port 12434 (for pnpm dev).',
      );
      note('This changes a Docker Desktop setting (Settings → AI).');
      exec('docker', ['desktop', 'enable', 'model-runner', '--tcp=12434']);
    } else {
      note(
        'Docker Engine: start Model Runner as its documentation describes, then run setup again.',
      );
    }
    step(
      'The model (several GB the first time; downloads to this machine only)',
    );
    if (!exec('docker', ['model', 'pull', model]))
      throw new SetupError(`Couldn't pull ${model}.`);
    // pnpm dev talks to Model Runner directly; give it the same context as the stack.
    exec('docker', [
      'model',
      'configure',
      '--context-size',
      CONTEXT_SIZE,
      model,
    ]);
  } else if (provider === 'ollama') {
    step('Ollama');
    note(
      `The stack runs Ollama in a container and pulls ${model} on its first start`,
    );
    note(
      '(several GB; downloads to this machine only, kept in the ollama-models volume).',
    );
    if (facts.machine.platform === 'darwin')
      note(
        'On a Mac, containers have no GPU: Docker Model Runner is much faster.',
      );
  } else {
    step('OpenAI-compatible server');
    note(
      `The stack's agent will use ${env.STACK_LLM_URL} with the model ${model}.`,
    );
    if (env.LLM_URL) {
      const ok = await fetch(
        new URL('models', env.LLM_URL.replace(/\/*$/, '/')),
        {
          headers: env.LLM_API_KEY
            ? { authorization: `Bearer ${env.LLM_API_KEY}` }
            : {},
          signal: AbortSignal.timeout(3000),
        },
      ).then(
        (r) => r.ok,
        () => false,
      );
      note(
        ok
          ? `LLM_URL (${env.LLM_URL}) answers`
          : `LLM_URL (${env.LLM_URL}) does not answer yet (pnpm dev needs it)`,
      );
    }
  }

  // ------------------------------------------------------------------ 4. downloads
  step('Base images (downloads to this machine only)');
  const images = [
    env.NODE_IMAGE || 'node:24-alpine',
    env.MONGO_IMAGE || 'mongo:8',
  ];
  if (provider === 'ollama')
    images.push(env.OLLAMA_IMAGE || 'ollama/ollama:latest');
  for (const image of images) {
    if (!exec('docker', ['pull', '--quiet', image])) {
      throw new SetupError(
        `Couldn't pull ${image}. If Docker Hub answered 429 (rate limit), set NODE_IMAGE and MONGO_IMAGE in .env to another registry (examples in .env.example), then run setup again.`,
      );
    }
  }

  // ------------------------------------------------------------------ 5. images
  step("Building the stack's images");
  if (
    !exec(
      'docker',
      ['compose', '--profile', 'stack', '--profile', 'seed', 'build'],
      composeEnv,
    )
  ) {
    throw new SetupError('The build failed (see above).');
  }

  // ------------------------------------------------------------------ 6. start
  step('Starting the stack');
  const busy = (await collectFacts(root, env, true, { provider })).ports.filter(
    (port) => port.inUse && !port.byStack,
  );
  for (const { port } of busy) {
    if (dryRun) note(`port ${port} is in use: a real run would stop here`);
    else
      throw new SetupError(
        `Port ${port} is in use by something else (pnpm dev?). Stop it, then run setup again.`,
      );
  }
  if (
    !exec(
      'docker',
      ['compose', '--profile', 'stack', 'up', '-d', '--wait'],
      composeEnv,
    )
  ) {
    throw new SetupError(
      'The stack did not start (docker compose logs shows why).',
    );
  }

  step('Database');
  if (dryRun) {
    note(
      'would load Northwind if the database is empty (docker compose run --rm seed)',
    );
  } else {
    const orders = orderCount(root, env.MONGO_DB || 'northwind');
    if (orders)
      note(
        `already has ${orders} orders; keeping it (pnpm stack:seed resets it)`,
      );
    else exec('docker', ['compose', 'run', '--rm', 'seed'], composeEnv);
  }

  // ------------------------------------------------------------------ done
  step('Done');
  const port = env.AGENT_PORT || 5173;
  const shared = env.AGENT_BIND === '0.0.0.0';
  console.log(`  The chat:        http://localhost:${port}   (the first answer takes longer while the model loads)
  Logs:            docker compose logs -f agent
  Stop:            docker compose --profile '*' down        (the data stays)
  Start again:     docker compose --profile stack up -d --wait`);
  const addresses = networkAddresses().map((a) => `http://${a}:${port}`);
  console.log(
    shared
      ? `\n  Shared on your network: others open ${addresses.join(' or ') || `this machine's address, port ${port}`}.`
      : '\n  To share the chat on your local network, set AGENT_BIND=0.0.0.0 in .env and start again' +
          (addresses.length
            ? `;\n  others then open ${addresses.join(' or ')}.`
            : '.'),
  );
  console.log(
    '  There is no login: anyone on the network can ask questions (the data is read-only).',
  );
}

/** Which model server: asked when there is someone to ask, else the suggestion. */
async function askProvider(suggestion, yes) {
  if (yes || !process.stdin.isTTY) return suggestion.provider;
  console.log(
    `\n  Where should the model run? Suggested for this machine: ${PROVIDERS[suggestion.provider].label} (${suggestion.reason}).`,
  );
  PROVIDER_NAMES.forEach((name, i) =>
    console.log(
      `    ${i + 1}. ${PROVIDERS[name].label}: ${PROVIDERS[name].summary}`,
    ),
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question(
        `  Choose 1–${PROVIDER_NAMES.length} [${PROVIDER_NAMES.indexOf(suggestion.provider) + 1}]: `,
      )
    ).trim();
    return answer
      ? (PROVIDER_NAMES[Number(answer) - 1] ?? answer)
      : suggestion.provider;
  } finally {
    rl.close();
  }
}
