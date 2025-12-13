/**
 * Resilient RPC call with retry logic for transient failures
 *
 * Production Edge Functions need to handle:
 * - Database connection pool exhaustion during startup
 * - Transient network failures
 * - Cold start delays
 */
export async function callRpc(
  url: string,
  serviceKey: string,
  body: Record<string, unknown>,
  options: {
    maxRetries?: number;
    initialBackoffMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<unknown> {
  const {
    maxRetries = 3,
    initialBackoffMs = 100,
    timeoutMs = 5000,
  } = options;

  let lastError: Error | null = null;
  let backoff = initialBackoffMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Success
      if (response.ok) {
        return await response.json();
      }

      // Client errors (4xx) should not be retried - these are permanent
      if (response.status >= 400 && response.status < 500) {
        const errorText = await response.text();
        throw new Error(`RPC call failed with ${response.status}: ${errorText}`);
      }

      // Server errors (5xx) - retry with backoff
      if (attempt < maxRetries) {
        console.warn(`RPC call failed with ${response.status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff *= 2; // Exponential backoff
        continue;
      }

      // Max retries exceeded
      const errorText = await response.text();
      throw new Error(`RPC call failed after ${maxRetries} retries: ${response.status} ${errorText}`);

    } catch (error) {
      const err = error as Error;
      lastError = err;

      // AbortError means timeout - retry
      if (err.name === "AbortError" && attempt < maxRetries) {
        console.warn(`RPC call timed out, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff *= 2;
        continue;
      }

      // Other errors - if we have retries left, try again
      if (attempt < maxRetries) {
        console.warn(`RPC call error: ${err.message}, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff *= 2;
        continue;
      }

      // Max retries exceeded
      throw err;
    }
  }

  throw lastError || new Error("RPC call failed with unknown error");
}
