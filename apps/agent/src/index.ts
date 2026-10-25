import { buildSystemPrompt } from './chat';
import { ConfigError, loadConfig, PROVIDER_DEFAULTS } from './config';
import { createLlmClient } from './llm';
import { profileFor } from './profiles';
import { startMcp } from './mcp';
import { createAgentServer } from './server';

const log = (message: string) => console.log(`[agent] ${message}`);

/** Is the model server up? A quick look at its model list; never throws. */
async function llmReachable(llmUrl: string, apiKey?: string): Promise<boolean> {
  try {
    const res = await fetch(new URL('models', llmUrl), {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[agent] ${error.message}`);
    process.exit(1);
  }

  const mcp = await startMcp({ apiUrl: config.apiUrl, apiKey: config.apiKey });
  // Without its tools the agent is useless: exit, so Docker (or the developer) restarts it.
  mcp.onClose(() => {
    console.error('[agent] The MCP server stopped; exiting.');
    process.exit(1);
  });

  const profile = profileFor(config.llmModel, config.llmProfile);
  const thinking = profile.thinkingSwitch && config.llmThinking;
  const provider = PROVIDER_DEFAULTS[config.llmProvider].label;
  const llm = createLlmClient({
    url: config.llmUrl,
    model: config.llmModel,
    label: provider,
    apiKey: config.llmApiKey,
    temperature: config.llmTemperature,
  });
  const server = createAgentServer({
    catalog: mcp,
    llm,
    systemPrompt: buildSystemPrompt({
      instructions: mcp.instructions,
      profile,
      thinking,
    }),
    profile,
    thinking,
    webDir: config.webDir,
    provider: config.llmProvider,
    checkLlm: () => llmReachable(config.llmUrl, config.llmApiKey),
  });

  server.listen(config.port, config.host, () => {
    log(
      `chat on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
    );
    log(`${mcp.tools.length} read-only MCP tools; API at ${config.apiUrl}`);
    log(
      `model ${config.llmModel} on ${provider} at ${config.llmUrl}, profile ${profile.name}${thinking ? ', thinking on' : ''}`,
    );
    if (config.llmThinking && !profile.thinkingSwitch) {
      log(
        `LLM_THINKING=1 has no effect: the ${profile.name} profile has no thinking switch`,
      );
    }
    if (config.host === '0.0.0.0') {
      log(
        'listening on all interfaces: anyone on this network can use the chat (read-only, no login)',
      );
    }
    void llmReachable(config.llmUrl, config.llmApiKey).then((up) => {
      if (!up)
        log(
          'the model server is not reachable yet; chats will say so until it is (the page shows "Model server offline")',
        );
    });
  });

  const shutdown = () => {
    server.close();
    void mcp.close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error(
    `[agent] failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
