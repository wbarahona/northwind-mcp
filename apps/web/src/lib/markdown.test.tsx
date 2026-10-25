import { render } from '@testing-library/react';
import { Markdown } from './markdown';

const html = (text: string) =>
  render(<Markdown text={text} />).container.innerHTML;

describe('Markdown', () => {
  it('renders paragraphs, bold and inline code', () => {
    expect(html('Order **ORD-10248** has `3` lines.\n\nShipped.')).toBe(
      '<p>Order <strong>ORD-10248</strong> has <code>3</code> lines.</p><p>Shipped.</p>',
    );
  });

  it('renders bullet and numbered lists, and switches between them', () => {
    expect(
      html('Top customers:\n1. QUICK-Stop\n2. Ernst Handel\n- note\n* another'),
    ).toBe(
      '<p>Top customers:</p><ol><li>QUICK-Stop</li><li>Ernst Handel</li></ol><ul><li>note</li><li>another</li></ul>',
    );
  });

  it('keeps code literal (no bold inside it)', () => {
    expect(html('`**not bold**`')).toBe('<p><code>**not bold**</code></p>');
  });

  it('never turns model output into markup', () => {
    const { container } = render(
      <Markdown
        text={'<img src=x onerror="alert(1)"> and <script>alert(2)</script>'}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe(
      '<img src=x onerror="alert(1)"> and <script>alert(2)</script>',
    );
  });
});
