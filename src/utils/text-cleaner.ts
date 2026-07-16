/**
 * Text Cleaner Utilities
 *
 * Shared functions for cleaning and truncating text before sending to LLM.
 * Strips HTTP links and truncates by "content character" count
 * (letters, digits, CJK ideographs — excluding punctuation/spaces/symbols).
 */

/**
 * Strip HTTP/HTTPS links from text and normalize whitespace.
 */
export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Truncate text to a given number of "content characters" (letters, digits, CJK ideographs),
 * counting only meaningful characters and ignoring punctuation, spaces, and symbols.
 * Also strips HTTP/HTTPS links before truncation.
 *
 * @param text - Input text to clean and truncate
 * @param maxContentChars - Maximum number of meaningful characters to keep
 * @returns Cleaned and possibly truncated text, with '...' appended if truncated
 */
export function truncatePreview(text: string, maxContentChars: number): string {
  const cleaned = stripUrls(text);
  if (cleaned.length <= maxContentChars) return cleaned;

  // Walk through chars, count only content chars, find cutoff point
  let contentCount = 0;
  let cutIndex = cleaned.length;
  for (let i = 0; i < cleaned.length; i++) {
    // Unicode Letter (includes CJK) or Number
    if (/[\p{L}\p{N}]/u.test(cleaned[i])) {
      contentCount++;
      if (contentCount > maxContentChars) {
        cutIndex = i;
        break;
      }
    }
  }

  if (contentCount <= maxContentChars) return cleaned;
  return cleaned.substring(0, cutIndex) + '...';
}
