// The model servers the stack can use, and which one suits a machine. Pure: no commands run
// here, so it is easy to test (providers.test.mjs).

/** The base Compose file, without a model server. */
export const BASE_COMPOSE = 'docker-compose.yml';

export const PROVIDERS = {
  'docker-model-runner': {
    label: 'Docker Model Runner',
    summary:
      'Docker Desktop runs the model; on Apple silicon natively, on the Metal GPU',
    composeFiles: ['compose.model-runner.yml'],
    defaultModel: 'hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M',
    bigModel: 'hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M',
    local: true,
  },
  ollama: {
    label: 'Ollama',
    summary: 'an Ollama container: any OS, on the CPU or an NVIDIA GPU',
    composeFiles: ['compose.ollama.yml'],
    defaultModel: 'qwen3:4b',
    bigModel: 'qwen3:8b',
    local: true,
  },
  'openai-compatible': {
    label: 'OpenAI-compatible server',
    summary:
      'any server with the OpenAI chat API (llama.cpp, LM Studio, vLLM, a cloud API)',
    composeFiles: [],
    local: false,
  },
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/** What .env says, applying the rule for files from before providers existed. */
export const providerOf = (env) =>
  env.LLM_PROVIDER?.trim() || 'docker-model-runner';

/** The COMPOSE_FILE value for a provider: the base file, then the provider's own. */
export function composeFileFor(
  provider,
  { nvidia = false, separator = ':' } = {},
) {
  const files = [BASE_COMPOSE, ...PROVIDERS[provider].composeFiles];
  if (provider === 'ollama' && nvidia) files.push('compose.ollama-nvidia.yml');
  return files.join(separator);
}

/**
 * The model server to suggest for this machine, with the reason.
 * facts: { appleSilicon, modelRunner: { installed }, nvidia: string | null }
 */
export function suggestProvider(facts) {
  if (facts.appleSilicon && facts.modelRunner.installed) {
    return {
      provider: 'docker-model-runner',
      reason: 'Apple silicon: Docker Model Runner runs the model on the GPU',
    };
  }
  if (facts.nvidia) {
    return {
      provider: 'ollama',
      nvidia: true,
      reason: `an NVIDIA GPU (${facts.nvidia}): Ollama in a container can use it`,
    };
  }
  if (facts.modelRunner.installed) {
    return {
      provider: 'docker-model-runner',
      reason: 'Docker Model Runner is installed (the model runs on the CPU)',
    };
  }
  return {
    provider: 'ollama',
    reason:
      'no GPU found: Ollama runs the model on the CPU in a container (slow, but works anywhere)',
  };
}

/** Which model fits this much memory, for a local provider. */
export function modelAdvice(provider, memoryGb) {
  const p = PROVIDERS[provider];
  if (!p.local)
    return {
      level: 'ok',
      text: 'the model runs elsewhere: memory here does not matter',
    };
  if (memoryGb >= 24) {
    return {
      level: 'ok',
      text: `${memoryGb} GB memory: Qwen3 4B (the default), or Qwen3 8B (${p.bigModel}) for the most accurate answers`,
    };
  }
  if (memoryGb >= 16)
    return {
      level: 'ok',
      text: `${memoryGb} GB memory: Qwen3 4B (the default)`,
    };
  if (memoryGb >= 8)
    return {
      level: 'warn',
      text: `${memoryGb} GB memory: Qwen3 4B fits, but close other apps while chatting`,
    };
  return {
    level: 'bad',
    text: `${memoryGb} GB memory: too little for a local model (use an OpenAI-compatible server elsewhere)`,
  };
}
