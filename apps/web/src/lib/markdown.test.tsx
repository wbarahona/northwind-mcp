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

  it('renders a table with alignment, inline formatting and missing cells', () => {
    expect(
      html(
        'Top customers:\n| Customer | Revenue |\n|---|--:|\n| **QUICK** | 1.00 |\n| `ERNSH` |\nDone.',
      ),
    ).toBe(
      '<p>Top customers:</p><div class="table-wrap"><table>' +
        '<thead><tr><th>Customer</th><th class="align-right">Revenue</th></tr></thead>' +
        '<tbody><tr><td><strong>QUICK</strong></td><td class="align-right">1.00</td></tr>' +
        '<tr><td><code>ERNSH</code></td><td class="align-right"></td></tr></tbody>' +
        '</table></div><p>Done.</p>',
    );
  });

  it('accepts tables without outer pipes and keeps escaped pipes literal', () => {
    expect(html('a | b\n:-: | ---\nx \\| y | z')).toBe(
      '<div class="table-wrap"><table>' +
        '<thead><tr><th class="align-center">a</th><th>b</th></tr></thead>' +
        '<tbody><tr><td class="align-center">x | y</td><td>z</td></tr></tbody>' +
        '</table></div>',
    );
  });

  it('leaves pipes as text when no separator row follows', () => {
    expect(html('| still streaming |')).toBe('<p>| still streaming |</p>');
  });

  it('turns <br> into a line break, in table cells and text, but no other tag', () => {
    expect(
      html('| Top |\n|---|\n| 1. Chai <br> 2. Chang<BR/>3. **Ikura<br />x** |'),
    ).toBe(
      '<div class="table-wrap"><table><thead><tr><th>Top</th></tr></thead><tbody><tr><td>' +
        '1. Chai <br> 2. Chang<br>3. <strong>Ikura<br>x</strong></td></tr></tbody></table></div>',
    );
    expect(html('a<br>b `<br>` <b>c</b>')).toBe(
      '<p>a<br>b <code>&lt;br&gt;</code> &lt;b&gt;c&lt;/b&gt;</p>',
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
