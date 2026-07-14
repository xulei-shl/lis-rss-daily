/**
 * Shared Telegram utilities
 */

/**
 * Serialize an error (or unknown value) into a plain object for structured logging.
 * Shared by TelegramClient and TelegramBot which had identical copies.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: cause instanceof Error
        ? {
            name: cause.name,
            message: cause.message,
            stack: cause.stack,
          }
        : cause,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>;
  }

  return { value: String(error) };
}
