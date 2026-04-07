import { describe, expect, it } from 'vitest';
import { app } from '../../index';

describe('Runtime Contract Regression', () => {
  it('keeps provider list endpoint response shape stable', async () => {
    const res = await app.request('/api/providers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.success).toBe('boolean');
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it('keeps sandbox execute endpoint response shape stable', async () => {
    const res = await app.request('/api/sandbox/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo regression-check' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.success).toBe('boolean');
    expect(typeof body.stdout).toBe('string');
    expect(typeof body.stderr).toBe('string');
    expect(typeof body.exitCode).toBe('number');
    expect(typeof body.timedOut).toBe('boolean');
    expect(typeof body.classification).toBe('string');
    expect(typeof body.started).toBe('boolean');
    expect(body.healthPassed === null || typeof body.healthPassed === 'boolean').toBe(true);
  });

  it('keeps sandbox exec compatibility endpoint response shape stable', async () => {
    const res = await app.request('/api/sandbox/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo regression-compat' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.success).toBe('boolean');
    expect(typeof body.stdout).toBe('string');
    expect(typeof body.stderr).toBe('string');
    expect(typeof body.exitCode).toBe('number');
    expect(typeof body.timedOut).toBe('boolean');
    expect(typeof body.classification).toBe('string');
  });
});
