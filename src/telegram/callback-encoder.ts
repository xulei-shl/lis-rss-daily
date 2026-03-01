/**
 * Telegram Callback Data Encoder/Decoder
 *
 * Encodes and decodes callback_data for Inline Keyboard buttons.
 * Format: "action:articleId:value"
 * Example: "mr:12345:1" = mark article 12345 as read
 */

/**
 * Callback action types
 */
export enum CallbackAction {
  MARK_READ = 'mr',      // Mark as read/unread
  RATE = 'rt',           // Submit rating
  SHOW_RATING = 'sr',    // Show rating keyboard
  CANCEL = 'cl',         // Cancel operation
}

/**
 * Encode callback data
 * @param action - Action type
 * @param articleId - Article ID
 * @param value - Optional value (rating number, etc.)
 */
export function encodeCallback(
  action: CallbackAction,
  articleId: number,
  value?: string | number
): string {
  const parts: string[] = [action, String(articleId)];
  if (value !== undefined) {
    parts.push(String(value));
  }
  return parts.join(':');
}

/**
 * Decode callback data
 * @param data - Callback data string
 * @returns Decoded data or null if invalid
 */
export function decodeCallback(
  data: string
): { action: CallbackAction; articleId: number; value?: string } | null {
  if (!data || typeof data !== 'string') {
    return null;
  }

  const parts = data.split(':');
  if (parts.length < 2) {
    return null;
  }

  const [action, articleIdStr, value] = parts;

  // Validate action
  const validActions = Object.values(CallbackAction) as string[];
  if (!validActions.includes(action)) {
    return null;
  }

  // Parse article ID
  const articleId = parseInt(articleIdStr, 10);
  if (isNaN(articleId)) {
    return null;
  }

  return {
    action: action as CallbackAction,
    articleId,
    value,
  };
}
