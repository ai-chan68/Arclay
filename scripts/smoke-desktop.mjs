#!/usr/bin/env node

const baseUrl = process.env.EASYWORK_API_BASE_URL || process.argv[2] || 'http://localhost:2026';

async function requestJson(path) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(4000),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep payload null for non-JSON responses
  }

  return { url, response, payload };
}

async function requestJsonWithOptions(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(4000),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep payload null for non-JSON responses
  }

  return { url, response, payload };
}

async function runCheck(name, path, validator) {
  try {
    const { url, response, payload } = await requestJson(path);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    const validationError = validator(payload);
    if (validationError) {
      throw new Error(validationError);
    }

    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  console.log(`[smoke] Using API base URL: ${baseUrl}`);

  const checks = await Promise.all([
    runCheck('health', '/api/health', (payload) =>
      payload?.status === 'ok' ? null : 'Expected status=ok'
    ),
    runCheck('settings', '/api/settings', (payload) =>
      payload && typeof payload === 'object' && 'providers' in payload
        ? null
        : 'Expected settings payload with providers field'
    ),
    runCheck('preview-list', '/api/preview/list', (payload) =>
      Array.isArray(payload?.instances)
        ? null
        : 'Expected preview list payload with instances array'
    ),
    runCheck('skills-list', '/api/settings/skills/list', (payload) =>
      Array.isArray(payload?.skills)
        ? null
        : 'Expected skills list payload with skills array'
    ),
    (async () => {
      const name = 'v2-agent-plan-route';
      try {
        const { url, response } = await requestJsonWithOptions('/api/v2/agent/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });

        // Route exists should return 400 for missing prompt.
        if (response.status !== 400) {
          throw new Error(`Expected HTTP 400 but got ${response.status} from ${url}`);
        }

        console.log(`PASS ${name}`);
        return true;
      } catch (error) {
        console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    })(),
  ]);

  if (checks.every(Boolean)) {
    console.log('[smoke] Desktop API smoke checks passed.');
    process.exit(0);
  }

  console.error('[smoke] Desktop API smoke checks failed.');
  process.exit(1);
}

main().catch((error) => {
  console.error(`[smoke] Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
