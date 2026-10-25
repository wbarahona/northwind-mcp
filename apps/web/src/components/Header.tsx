export type StatusState = 'checking' | 'ready' | 'error';

export function Header({
  subtitle,
  status,
  statusText,
}: {
  subtitle: string;
  status: StatusState;
  statusText: string;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          N
        </span>
        <div>
          <h1>Northwind Assistant</h1>
          <p className="sub">{subtitle}</p>
        </div>
      </div>
      <div className="status" data-state={status} role="status">
        <span className="dot" aria-hidden="true" />
        <span>{statusText}</span>
      </div>
    </header>
  );
}
