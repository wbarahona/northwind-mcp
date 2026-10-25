import { SUGGESTIONS } from '../lib/suggestions';

export function Welcome({
  onAsk,
  disabled,
}: {
  onAsk: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title">
        Ask about customers, orders, products and sales
      </h2>
      <p>
        Answers come from the Northwind data through read-only tools, on this
        computer. Each answer shows how it was produced under{' '}
        <em>How I got this</em>.
      </p>
      <div className="suggestions">
        {Object.entries(SUGGESTIONS).map(([group, questions]) => (
          <div key={group}>
            <h3>{group}</h3>
            <div className="chips">
              {questions.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="chip"
                  disabled={disabled}
                  onClick={() => onAsk(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
