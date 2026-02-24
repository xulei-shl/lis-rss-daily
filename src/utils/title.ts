/**
 * Title normalization utilities for article deduplication
 */

/**
 * Normalize title for deduplication
 *
 * Rules:
 * - Convert to lowercase
 * - Remove punctuation and special characters
 * - Keep Chinese characters, letters, numbers, and spaces
 * - Collapse multiple whitespace to single space
 * - Trim leading/trailing spaces
 *
 * @param title - Original title
 * @returns Normalized title or null if input is invalid/empty
 */
export function normalizeTitle(title: string): string | null {
  if (!title || typeof title !== 'string') {
    return null;
  }

  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // 1. Convert to lowercase
  let normalized = trimmed.toLowerCase();

  // 2. Remove punctuation and special characters
  // Keep: word characters, whitespace, Chinese characters
  // \u4e00-\u9fff: Common Chinese characters
  // \u3400-\u4dbf: Chinese extension A
  normalized = normalized.replace(/[^\w\s\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');

  // 3. Collapse multiple whitespace to single space
  normalized = normalized.replace(/\s+/g, ' ');

  // 4. Trim leading/trailing spaces
  normalized = normalized.trim();

  // 5. Return null if empty after normalization
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

/**
 * Generate normalized title for storage
 * Returns null if title cannot be normalized (such article won't participate in title deduplication)
 *
 * @param title - Original title
 * @returns Normalized title (max 500 chars) or null
 */
export function generateNormalizedTitle(title: string): string | null {
  const normalized = normalizeTitle(title);

  // Limit length to prevent index issues
  if (normalized && normalized.length > 500) {
    return normalized.substring(0, 500);
  }

  return normalized;
}
