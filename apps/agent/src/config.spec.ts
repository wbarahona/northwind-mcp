import {
  ConfigError,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_URL,
  DEFAULT_WEB_DIR,
  loadConfig,
} from './config';

describe('loadConfig', () => {
  it('needs only the API key; everything else has a default', () => {
    expect(loadConfig({ NORTHWIND_API_KEY: 'k' })).toEqual({
      port: 5173,
      host: '127.0.0.1',
      llmProvider: 'docker-model-runner',
      llmUrl: DEFAULT_LLM_URL,
      llmModel: DEFAULT_LLM_MODEL,
      llmThinking: false,
      apiUrl: 'http://localhost:3000',
      apiKey: 'k',
      webDir: DEFAULT_WEB_DIR,
    });
    expect(DEFAULT_WEB_DIR).toMatch(/apps\/web\/dist$/);
  });

  it('reads every variable and normalizes URLs', () => {
    expect(
      loadConfig({
        PORT: '5174',
        HOST: '0.0.0.0',
        LLM_PROVIDER: 'openai-compatible',
        LLM_URL: 'http://model-runner.docker.internal/engines/v1',
        LLM_MODEL: 'hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M',
        LLM_API_KEY: ' sk-test ',
        LLM_PROFILE: 'generic',
        LLM_THINKING: '1',
        NORTHWIND_API_URL: 'http://api:3000/',
        NORTHWIND_API_KEY: ' secret ',
        WEB_DIR: '/app/web',
        LLM_TEMPERATURE: '0.2',
      }),
    ).toEqual({
      port: 5174,
      host: '0.0.0.0',
      llmProvider: 'openai-compatible',
      llmUrl: 'http://model-runner.docker.internal/engines/v1/',
      llmModel: 'hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M',
      llmApiKey: 'sk-test',
      llmProfile: 'generic',
      llmThinking: true,
      llmTemperature: 0.2,
      apiUrl: 'http://api:3000',
      apiKey: 'secret',
      webDir: '/app/web',
    });
  });

  it("takes the URL and model from the provider's defaults, unless they are set", () => {
    expect(
      loadConfig({ NORTHWIND_API_KEY: 'k', LLM_PROVIDER: 'ollama' }),
    ).toMatchObject({
      llmProvider: 'ollama',
      llmUrl: 'http://localhost:11434/v1/',
      llmModel: 'qwen3:4b',
    });
    expect(
      loadConfig({
        NORTHWIND_API_KEY: 'k',
        LLM_PROVIDER: 'ollama',
        LLM_MODEL: 'qwen3:8b',
      }),
    ).toMatchObject({
      llmUrl: 'http://localhost:11434/v1/',
      llmModel: 'qwen3:8b',
    });
  });

  it('needs LLM_URL and LLM_MODEL with openai-compatible, which has no defaults', () => {
    expect(() =>
      loadConfig({ NORTHWIND_API_KEY: 'k', LLM_PROVIDER: 'openai-compatible' }),
    ).toThrow(
      'Invalid configuration: LLM_URL is required with LLM_PROVIDER=openai-compatible; LLM_MODEL is required with LLM_PROVIDER=openai-compatible',
    );
  });

  it('treats empty values as unset', () => {
    expect(
      loadConfig({
        NORTHWIND_API_KEY: 'k',
        PORT: '',
        LLM_URL: ' ',
        LLM_PROVIDER: '',
        LLM_API_KEY: '',
      }),
    ).toEqual(
      expect.not.objectContaining({ llmApiKey: expect.anything() as unknown }),
    );
    expect(
      loadConfig({ NORTHWIND_API_KEY: 'k', PORT: '', LLM_URL: ' ' }),
    ).toMatchObject({
      port: 5173,
      llmProvider: 'docker-model-runner',
      llmUrl: DEFAULT_LLM_URL,
    });
  });

  it('lists every problem in one error', () => {
    let error: unknown;
    try {
      loadConfig({
        PORT: '99999',
        HOST: 'everywhere',
        LLM_PROVIDER: 'lmstudio',
        LLM_PROFILE: 'llama',
        LLM_THINKING: 'yes',
        LLM_TEMPERATURE: '3',
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toMatch(/^Invalid configuration: /);
    expect(message).toContain('PORT');
    expect(message).toContain('HOST must be an IPv4 address');
    expect(message).toContain(
      'LLM_PROVIDER must be one of docker-model-runner, ollama, openai-compatible',
    );
    expect(message).toContain('LLM_PROFILE must be one of qwen3, generic');
    expect(message).toContain('LLM_THINKING must be 0 or 1');
    expect(message).toContain('LLM_TEMPERATURE must be a number from 0 to 2');
    expect(message).toContain('NORTHWIND_API_KEY is required');
  });
});
