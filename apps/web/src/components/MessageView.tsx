import {
  type AssistantMessage,
  type Message,
  traceSummary,
} from '../lib/chat-state';
import { Markdown } from '../lib/markdown';

function Trace({ message }: { message: AssistantMessage }) {
  return (
    <details className="trace">
      <summary>{traceSummary(message)}</summary>
      <ol>
        {message.steps.map((step, i) => (
          <li key={i} className={step.isError ? 'error' : undefined}>
            <span className="k">{step.label}</span> · {step.detail}
            {step.payload && <pre>{step.payload}</pre>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function AssistantBody({ message: m }: { message: AssistantMessage }) {
  switch (m.status) {
    case 'thinking':
      return m.reasoning ? (
        <div className="reasoning">{m.reasoning.trim()}</div>
      ) : (
        <span className="thinking">Thinking…</span>
      );
    case 'waiting':
      return (
        <span className="thinking">
          Waiting for the model: {m.ahead}{' '}
          {m.ahead === 1 ? 'question' : 'questions'} ahead…
        </span>
      );
    case 'tools':
      return <span className="thinking">Looking it up…</span>;
    case 'streaming':
    case 'done':
      return <Markdown text={m.answer} />;
    case 'stopped':
      return (
        <>
          {m.answer && <Markdown text={m.answer} />}
          <p className="thinking">Stopped.</p>
        </>
      );
    case 'error':
      return (
        <>
          {m.answer && <Markdown text={m.answer} />}
          <p>{m.error}</p>
        </>
      );
  }
}

export function MessageView({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">{message.text}</div>
      </div>
    );
  }
  return (
    <div
      className="msg assistant"
      aria-busy={!['done', 'error', 'stopped'].includes(message.status)}
    >
      <div className={`bubble${message.status === 'error' ? ' error' : ''}`}>
        <AssistantBody message={message} />
      </div>
      <Trace message={message} />
    </div>
  );
}
