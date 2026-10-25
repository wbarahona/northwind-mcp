import { createReadStream, existsSync, statSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { extname, join, normalize, relative, sep } from 'node:path';
import { type ChatEvent, runChat, type Turn } from './chat';
import type { LlmClient } from './llm';
import type { McpCatalog } from './mcp';

export interface AgentServerOptions {
  catalog: McpCatalog;
  llm: LlmClient;
  systemPrompt: string;
  thinking: boolean;
  /** The built chat page (index.html + assets). */
  webDir: string;
  /** Is the model server reachable? For /healthz; never throws. */
  checkLlm?: () => Promise<boolean>;
}

/** Request limits: this is served to other people on the network. */
export const LIMITS = {
  chatBodyBytes: 64 * 1024,
  questionChars: 2_000,
  historyTurns: 6,
  historyChars: 4_000,
};

/**
 * The page may only load and talk to this origin; no inline scripts or styles, no framing.
 * (React's markup needs no inline anything; Vite's build emits plain script and style files.)
 */
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const NOT_BUILT_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Northwind Assistant</title></head>
<body><h1>The chat page isn't built yet</h1>
<p>Run <code>pnpm build</code> in the repo, then reload. The API endpoints under /api work already.</p>
</body></html>`;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One chat at a time against the model; the rest wait in order. */
class ChatGate {
  private tail: Promise<void> = Promise.resolve();
  private inLine = 0;

  async run(
    work: () => Promise<void>,
    onWait: (ahead: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const ahead = this.inLine++;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => (release = resolve));
    try {
      if (ahead > 0) onWait(ahead);
      await previous;
      if (!signal.aborted) await work();
    } finally {
      this.inLine--;
      release();
    }
  }
}

export function createAgentServer(options: AgentServerOptions): Server {
  const gate = new ChatGate();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = new URL(req.url ?? '/', 'http://agent.local');
    const method = req.method ?? 'GET';

    if (pathname.startsWith('/api/') || pathname === '/healthz') {
      if (method === 'GET' && pathname === '/api/tools') {
        return sendJson(res, 200, {
          instructions: options.catalog.instructions,
          tools: options.catalog.tools,
          llm: { model: options.llm.model, thinking: options.thinking },
        });
      }
      if (method === 'GET' && pathname === '/healthz') {
        const llm = (await options.checkLlm?.().catch(() => false)) ?? false;
        return sendJson(res, 200, {
          status: 'ok',
          tools: options.catalog.tools.length,
          model: options.llm.model,
          llm: llm ? 'up' : 'down',
        });
      }
      if (method === 'POST' && pathname === '/api/chat') {
        const input = parseChat(await readJson(req, LIMITS.chatBodyBytes));
        return streamChat(req, res, input);
      }
      const known = ['/api/tools', '/api/chat', '/healthz'];
      throw known.includes(pathname)
        ? new HttpError(405, `${method} is not allowed here.`)
        : new HttpError(404, 'Not found.');
    }

    if (method !== 'GET' && method !== 'HEAD') {
      throw new HttpError(405, `${method} is not allowed here.`);
    }
    return serveStatic(options.webDir, pathname, res, method === 'HEAD');
  };

  const streamChat = async (
    req: IncomingMessage,
    res: ServerResponse,
    input: { question: string; history: Turn[] },
  ) => {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
    });
    const send = (event: ChatEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      await gate.run(
        () =>
          runChat(
            input,
            send,
            {
              llm: options.llm,
              toolbox: options.catalog.toolbox,
              systemPrompt: options.systemPrompt,
            },
            abort.signal,
          ),
        (ahead) => send({ type: 'waiting', ahead }),
        abort.signal,
      );
      send({ type: 'done' });
    } catch (error) {
      if (!abort.signal.aborted) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    res.end();
  };

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message =
        error instanceof HttpError
          ? error.message
          : 'Something went wrong in the agent.';
      if (!(error instanceof HttpError)) console.error('[agent]', error);
      if (!res.headersSent) sendJson(res, status, { error: message });
      else res.end();
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/** Reads a JSON body: JSON content type only (no cross-site form posts), within a size limit. */
async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw new HttpError(415, 'Send JSON (content-type: application/json).');
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'Request too large.');

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks).toString('utf8') || 'null',
    ) as unknown;
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

/** { question, history } from the page, within limits. */
export function parseChat(body: unknown): {
  question: string;
  history: Turn[];
} {
  const input = (body ?? {}) as { question?: unknown; history?: unknown };
  if (typeof input.question !== 'string' || !input.question.trim()) {
    throw new HttpError(400, 'Ask a question ("question" is empty).');
  }
  const question = input.question.trim();
  if (question.length > LIMITS.questionChars) {
    throw new HttpError(
      400,
      `The question is too long (at most ${LIMITS.questionChars} characters).`,
    );
  }
  const history: Turn[] = [];
  if (input.history !== undefined) {
    if (!Array.isArray(input.history)) {
      throw new HttpError(400, '"history" must be a list of earlier turns.');
    }
    for (const turn of input.history.slice(-LIMITS.historyTurns)) {
      const { question: q, answer: a } = (turn ?? {}) as {
        question?: unknown;
        answer?: unknown;
      };
      if (typeof q !== 'string' || typeof a !== 'string') {
        throw new HttpError(
          400,
          'Each history turn needs a question and an answer.',
        );
      }
      history.push({
        question: q.slice(0, LIMITS.historyChars),
        answer: a.slice(0, LIMITS.historyChars),
      });
    }
  }
  return { question, history };
}

/**
 * Files from the built page. Paths with an extension must exist; anything else gets
 * index.html, so the page's own routes work on reload. Nothing outside webDir is served.
 */
function serveStatic(
  webDir: string,
  pathname: string,
  res: ServerResponse,
  headOnly: boolean,
): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Bad path.');
  }
  const file = normalize(join(webDir, decoded));
  const inside = relative(webDir, file);
  if (inside.startsWith('..') || inside.split(sep).includes('..')) {
    throw new HttpError(404, 'Not found.');
  }

  const index = join(webDir, 'index.html');
  const isFile = (path: string) => existsSync(path) && statSync(path).isFile();
  let target: string;
  if (isFile(file)) target = file;
  else if (!extname(decoded) && isFile(index)) target = index;
  else if (!extname(decoded) && !existsSync(index)) {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(headOnly ? undefined : NOT_BUILT_PAGE);
    return;
  } else throw new HttpError(404, 'Not found.');

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type':
      CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
    // Vite puts content hashes in asset names, so those never change.
    'cache-control': inside.startsWith(`assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });
  if (headOnly) res.end();
  else createReadStream(target).pipe(res);
}
