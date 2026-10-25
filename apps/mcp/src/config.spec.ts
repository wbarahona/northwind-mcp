import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('needs only the API key; the URL and writes have defaults', () => {
    expect(loadConfig({ NORTHWIND_API_KEY: 'k' })).toEqual({
      apiUrl: 'http://localhost:3000',
      apiKey: 'k',
      writes: true,
    });
  });

  it('reads every variable and trims a trailing slash from the URL', () => {
    expect(
      loadConfig({
        NORTHWIND_API_URL: 'http://api:3000/',
        NORTHWIND_API_KEY: ' secret ',
        NORTHWIND_MCP_WRITES: 'FALSE',
      }),
    ).toEqual({ apiUrl: 'http://api:3000', apiKey: 'secret', writes: false });
  });

  it('treats empty values as unset (hosts pass unresolved variables as "")', () => {
    expect(
      loadConfig({
        NORTHWIND_API_URL: '',
        NORTHWIND_API_KEY: 'k',
        NORTHWIND_MCP_WRITES: ' ',
      }),
    ).toEqual({ apiUrl: 'http://localhost:3000', apiKey: 'k', writes: true });
    expect(() => loadConfig({ NORTHWIND_API_KEY: '' })).toThrow(
      /NORTHWIND_API_KEY is required/,
    );
  });

  it('lists every problem in one error', () => {
    const error = (() => {
      try {
        loadConfig({
          NORTHWIND_API_URL: 'ftp://example.com',
          NORTHWIND_MCP_WRITES: 'yes',
        });
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toBe(
      'Invalid configuration: NORTHWIND_API_URL must be an http(s) URL, e.g. http://localhost:3000; ' +
        "NORTHWIND_API_KEY is required: set it to one of the API's API_KEYS; " +
        'NORTHWIND_MCP_WRITES must be "true" or "false"',
    );
  });
});
