// pnpm stack:doctor's verdicts, from the facts system.mjs collects. Pure (checks.test.mjs).
//   ok: fine · warn: worth knowing, not blocking · bad: must be fixed first
import {
  composeFileFor,
  modelAdvice,
  PROVIDERS,
  providerOf,
  suggestProvider,
} from './providers.mjs';

export const MIN_COMPOSE = '2.24.0'; // the base file's `!reset`
export const MIN_COMPOSE_MODELS = '2.38.0'; // compose.model-runner.yml's `models:`
export const MIN_DESKTOP_MODEL_RUNNER = '4.40.0';

/** "2.38.1" >= "2.38.0"? Missing parts count as 0. */
export function versionAtLeast(min, version) {
  const a = min.split('.').map(Number);
  const b = String(version)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < a.length; i++) {
    if ((b[i] ?? 0) !== a[i]) return (b[i] ?? 0) > a[i];
  }
  return true;
}

/**
 * The model server to check against: the one asked for (setup --provider), else .env's, else
 * the one suggested for this machine.
 */
export function chosenProvider({ machine, docker, env, envExists, requested }) {
  const suggestion = suggestProvider({
    appleSilicon: machine.appleSilicon,
    nvidia: machine.nvidia,
    modelRunner: { installed: Boolean(docker.modelRunner?.installed) },
  });
  if (requested?.provider) {
    return {
      provider: requested.provider,
      nvidia:
        requested.provider === 'ollama' &&
        (requested.nvidia ?? Boolean(suggestion.nvidia)),
      configured: 'requested',
      suggestion,
    };
  }
  if (envExists && env.LLM_PROVIDER?.trim()) {
    const provider = providerOf(env);
    return {
      provider,
      nvidia: (env.COMPOSE_FILE ?? '').includes('compose.ollama-nvidia.yml'),
      configured: true,
      suggestion,
    };
  }
  // A .env from before providers means Model Runner.
  if (envExists)
    return {
      provider: 'docker-model-runner',
      nvidia: false,
      configured: false,
      suggestion,
    };
  return {
    provider: suggestion.provider,
    nvidia: Boolean(suggestion.nvidia),
    configured: false,
    suggestion,
  };
}

/**
 * facts: { machine, docker, env, envExists, ports: [{ port, inUse, byStack }], requested? }
 * Returns { sections: [{ title, items: [{ level, text }] }], failed, choice }.
 */
export function evaluate(facts) {
  const { machine, docker, env, envExists } = facts;
  const choice = chosenProvider(facts);
  const { provider } = choice;
  const p = PROVIDERS[provider];
  const sections = [];
  const section = (title) => {
    const items = [];
    sections.push({ title, items });
    return (level, text) => items.push({ level, text });
  };

  // ------------------------------------------------------------------ this machine
  let add = section('This machine');
  const osName = machine.wsl
    ? 'Linux on WSL2'
    : ({ darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[
        machine.platform
      ] ?? machine.platform);
  if (!p.local) add('ok', `${machine.cpu} (${osName})`);
  else if (machine.appleSilicon)
    add(
      'ok',
      `${machine.cpu} (${osName}, Apple silicon: Docker Model Runner can use the GPU)`,
    );
  else if (machine.nvidia)
    add(
      'ok',
      `${machine.cpu} (${osName}) with an NVIDIA GPU: ${machine.nvidia}`,
    );
  else
    add(
      'warn',
      `${machine.cpu} (${osName}): no supported GPU found, so the model runs on the CPU (slower answers)`,
    );

  const memory = modelAdvice(provider, machine.memoryGb);
  add(memory.level, memory.text);

  if (machine.freeDiskGb === null)
    add(
      'warn',
      'free disk unknown: the images and the model need about 10–15 GB',
    );
  else if (machine.freeDiskGb >= 15)
    add('ok', `${machine.freeDiskGb} GB free disk`);
  else
    add(
      'warn',
      `${machine.freeDiskGb} GB free disk: the images and the model need about 10–15 GB`,
    );

  // ------------------------------------------------------------------ docker
  add = section('Docker');
  if (!docker.installed) {
    add(
      'bad',
      "Docker isn't installed: get Docker Desktop (macOS, Windows) or Docker Engine (Linux) at https://docs.docker.com/get-started/get-docker/",
    );
  } else if (!docker.running) {
    add(
      'bad',
      'Docker is installed but not running: start it (Docker Desktop: open it and wait until it is ready)',
    );
  } else {
    add(
      'ok',
      docker.desktopVersion
        ? `Docker Desktop ${docker.desktopVersion}`
        : `Docker Engine ${docker.engineVersion ?? '(version unknown)'}`,
    );

    const minCompose =
      provider === 'docker-model-runner' ? MIN_COMPOSE_MODELS : MIN_COMPOSE;
    if (
      docker.composeVersion &&
      versionAtLeast(minCompose, docker.composeVersion)
    )
      add('ok', `Docker Compose ${docker.composeVersion}`);
    else
      add(
        'bad',
        `Docker Compose ${docker.composeVersion ?? 'missing'}: ${minCompose} or later is needed (update Docker)`,
      );

    if (provider === 'docker-model-runner') {
      const mr = docker.modelRunner;
      if (!mr.installed) {
        add(
          'bad',
          docker.desktopVersion &&
            !versionAtLeast(MIN_DESKTOP_MODEL_RUNNER, docker.desktopVersion)
            ? `Docker Model Runner needs Docker Desktop ${MIN_DESKTOP_MODEL_RUNNER} or later (Check for updates in Docker Desktop)`
            : 'Docker Model Runner is missing: update Docker Desktop, or install the docker-model-plugin on Docker Engine (or choose Ollama)',
        );
      } else if (!mr.running) {
        add('warn', 'Docker Model Runner is off: setup turns it on');
      } else {
        add(
          'ok',
          `Docker Model Runner is on${mr.hostTcp ? ', with access from this machine on port 12434' : ''}`,
        );
      }
      if (mr.installed && mr.running && !mr.hostTcp)
        add(
          'warn',
          'Docker Model Runner has no access from this machine on port 12434 (pnpm dev needs it): setup turns it on',
        );
      // The model runs outside Docker's VM: on a smaller machine, a big VM leaves it too little.
      if (
        docker.desktopVersion &&
        machine.memoryGb <= 16 &&
        (docker.vmMemoryGb ?? 0) > 4
      ) {
        add(
          'warn',
          `Docker's VM may use up to ${docker.vmMemoryGb} GB; the model runs outside it and needs the rest. With ${machine.memoryGb} GB, about 3 GB is enough (Docker Desktop → Settings → Resources → Memory)`,
        );
      }
    }
    if (provider === 'ollama') {
      // In Docker Desktop, Ollama and the model live inside the VM.
      if (
        docker.desktopVersion &&
        docker.vmMemoryGb !== null &&
        docker.vmMemoryGb < 8
      ) {
        add(
          'warn',
          `Docker's VM has ${docker.vmMemoryGb} GB; Ollama runs the model inside it and needs about 8 GB (Docker Desktop → Settings → Resources → Memory)`,
        );
      }
      if (
        choice.nvidia &&
        machine.platform === 'linux' &&
        !machine.wsl &&
        !docker.nvidiaRuntime
      ) {
        add(
          'bad',
          "Docker can't use the NVIDIA GPU: install the NVIDIA Container Toolkit, or drop compose.ollama-nvidia.yml from COMPOSE_FILE",
        );
      }
    }
  }

  // ------------------------------------------------------------------ model server
  add = section('Model server');
  const { suggestion } = choice;
  if (choice.configured) {
    add(
      'ok',
      `${p.label} (${choice.configured === 'requested' ? 'asked for' : 'LLM_PROVIDER in .env'})${suggestion.provider !== provider ? `; for this machine setup would suggest ${PROVIDERS[suggestion.provider].label}` : ''}`,
    );
  } else if (envExists) {
    add(
      'ok',
      `${p.label}: .env has no LLM_PROVIDER, which means Docker Model Runner (setup writes it down)`,
    );
  } else {
    add(
      'ok',
      `suggested: ${p.label} (${suggestion.reason}). Setup asks, or takes --provider`,
    );
  }
  if (provider === 'openai-compatible') {
    for (const key of ['LLM_URL', 'STACK_LLM_URL', 'LLM_MODEL']) {
      if (!env[key]?.trim()) {
        add(
          key === 'LLM_URL' ? 'warn' : 'bad',
          `${key} is not set${key === 'LLM_URL' ? ' (needed for pnpm dev only)' : ' (needed by the stack)'}`,
        );
      }
    }
  } else {
    // Model names differ between servers: switching servers means its default model.
    const switching = envExists && providerOf(env) !== provider;
    const model = switching ? undefined : env.LLM_MODEL?.trim();
    add(
      'ok',
      `model: ${model || p.defaultModel}${model ? '' : ' (the default)'}`,
    );
  }

  // ------------------------------------------------------------------ this repo
  add = section('This repo');
  if (!envExists) {
    add('warn', 'no .env yet: setup creates one with a random API key');
  } else {
    add('ok', '.env exists (setup keeps it)');
    const keys = (env.API_KEYS ?? '').split(',').map((k) => k.trim());
    if (env.NORTHWIND_API_KEY && !keys.includes(env.NORTHWIND_API_KEY.trim())) {
      add('bad', '.env: NORTHWIND_API_KEY must be one of API_KEYS');
    }
    const expected = composeFileFor(provider, { nvidia: choice.nvidia });
    const missing = [];
    if (env.LLM_PROVIDER?.trim() !== provider)
      missing.push(`LLM_PROVIDER=${provider}`);
    if ((env.COMPOSE_FILE ?? '').split(/[:;]/).join(':') !== expected)
      missing.push(`COMPOSE_FILE=${expected}`);
    if (missing.length)
      add('warn', `.env: setup will set ${missing.join(' and ')}`);
  }
  for (const { port, inUse, byStack } of facts.ports ?? []) {
    if (!inUse) add('ok', `port ${port} is free`);
    else if (byStack) add('ok', `port ${port} is used by the stack itself`);
    else
      add(
        'warn',
        `port ${port} is in use by something else (pnpm dev?): stop it before starting the stack`,
      );
  }

  const failed = sections.some((s) => s.items.some((i) => i.level === 'bad'));
  return { sections, failed, choice };
}
