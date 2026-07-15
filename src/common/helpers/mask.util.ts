const SECRET_KEY_PATTERN = /pass|secret|token|key|credential|webhook|dsn|auth/i;

const MASK = '********';

export function maskSecretValues<T extends Record<string, unknown>>(source: T): Record<string, unknown> {
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      masked[key] = MASK;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSecretValues(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}
