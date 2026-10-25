import { NodeEnv, validateEnv } from './env';

describe('validateEnv', () => {
  const valid = {
    MONGO_URI: 'mongodb://localhost:27017/northwind',
    API_KEYS: 'a, b ,,c',
  };

  it('applies defaults and converts types', () => {
    const env = validateEnv({ ...valid, PORT: '4000' });

    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.THROTTLE_LIMIT).toBe(300);
  });

  it('listens where HOST says, and only on an IP address', () => {
    expect(validateEnv({ ...valid, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
    expect(() => validateEnv({ ...valid, HOST: 'everywhere' })).toThrow(
      /HOST must be an IP address/,
    );
  });

  it('splits API_KEYS on commas and drops blanks', () => {
    expect(validateEnv(valid).API_KEYS).toEqual(['a', 'b', 'c']);
  });

  it('lists every problem at once', () => {
    const invalid = () =>
      validateEnv({ MONGO_URI: 'postgres://x', API_KEYS: ' , ', PORT: '0' });

    expect(invalid).toThrow(/MONGO_URI must be a mongodb/);
    expect(invalid).toThrow(/API_KEYS must contain at least one key/);
    expect(invalid).toThrow(/PORT must not be less than 1/);
  });
});
