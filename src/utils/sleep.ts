/**
 * Sleep utility — single shared implementation
 */

/**
 * Sleep for a specified duration in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
