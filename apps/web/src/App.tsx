import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Composer } from './components/Composer';
import { Header, type StatusState } from './components/Header';
import { MessageView } from './components/MessageView';
import { Welcome } from './components/Welcome';
import {
  type Catalog,
  fetchCatalog,
  fetchHealth,
  modelName,
  streamChat,
} from './lib/api';
import { chatReducer, historyFrom, initialChat } from './lib/chat-state';

type Connection =
  | { state: 'loading' }
  | { state: 'ready'; catalog: Catalog; llmUp: boolean }
  | { state: 'error'; message: string };

export function App() {
  const [connection, setConnection] = useState<Connection>({
    state: 'loading',
  });
  const [chat, dispatch] = useReducer(chatReducer, initialChat);
  const abort = useRef<AbortController | null>(null);
  const chatLog = useRef<HTMLElement>(null);

  const checkHealth = useCallback(async () => {
    const health = await fetchHealth().catch(() => null);
    setConnection((c) =>
      c.state === 'ready' ? { ...c, llmUp: health?.llm === 'up' } : c,
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchCatalog(controller.signal),
      fetchHealth(controller.signal),
    ])
      .then(([catalog, health]) =>
        setConnection({ state: 'ready', catalog, llmUp: health.llm === 'up' }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setConnection({
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => controller.abort();
  }, []);

  // Keep the newest message in view while it streams.
  useEffect(() => {
    const el = chatLog.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const ready = connection.state === 'ready';
  const model = ready ? modelName(connection.catalog.llm.model) : 'Model';

  const ask = async (question: string) => {
    if (chat.busy || !ready) return;
    const history = historyFrom(chat.messages);
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: 'ask', question, engine: model, at: performance.now() });
    try {
      for await (const event of streamChat(
        question,
        history,
        controller.signal,
      )) {
        dispatch({ type: 'event', event });
      }
      dispatch({ type: 'finish', at: performance.now(), outcome: 'done' });
    } catch (error) {
      dispatch({
        type: 'finish',
        at: performance.now(),
        outcome: controller.signal.aborted
          ? 'stopped'
          : {
              error: `Something went wrong: ${error instanceof Error ? error.message : String(error)}`,
            },
      });
    } finally {
      abort.current = null;
      void checkHealth();
    }
  };

  const [status, statusText]: [StatusState, string] =
    connection.state === 'loading'
      ? ['checking', 'Connecting…']
      : connection.state === 'error'
        ? ['error', 'Agent unreachable']
        : connection.llmUp
          ? ['ready', 'Model ready']
          : ['error', 'Model server offline'];

  const subtitle =
    connection.state === 'ready'
      ? `${model} · ${toolCount(connection.catalog.tools.length)}`
      : connection.state === 'error'
        ? `Can't reach the agent: ${connection.message}`
        : 'Northwind MCP tools';

  return (
    <>
      <Header subtitle={subtitle} status={status} statusText={statusText} />
      <main ref={chatLog} className="chat" role="log" aria-label="Conversation">
        {chat.messages.length === 0 ? (
          <Welcome onAsk={(q) => void ask(q)} disabled={!ready || chat.busy} />
        ) : (
          chat.messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))
        )}
      </main>
      <Composer
        onSend={(q) => void ask(q)}
        onStop={() => abort.current?.abort()}
        busy={chat.busy}
        disabled={!ready}
      />
    </>
  );
}

const toolCount = (n: number) => `${n} read-only ${n === 1 ? 'tool' : 'tools'}`;
