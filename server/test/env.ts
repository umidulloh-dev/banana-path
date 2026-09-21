/** Reads a variable that `setup-env.ts` guarantees is present. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set before the tests run`);
  return value;
}

export const TEST_PASSWORD = (): string => requireEnv('APP_PASSWORD');
