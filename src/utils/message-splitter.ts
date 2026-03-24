/**
 * Message Splitter Utility
 *
 * Splits long messages into chunks that fit within platform limits.
 * Used by Telegram (4096 chars) and WeChat (4096 bytes) clients.
 */

export const DEFAULT_MAX_LENGTH = 4096;

export function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

export function smartTruncate(str: string, maxBytes: number): { truncated: string; remaining: string } {
  const encoder = new TextEncoder();
  const totalBytes = getByteLength(str);

  if (totalBytes <= maxBytes) {
    return { truncated: str, remaining: '' };
  }

  let low = 0;
  let high = str.length;
  let bestLen = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const sliced = str.substring(0, mid);
    const bytes = encoder.encode(sliced).length;

    if (bytes <= maxBytes) {
      bestLen = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  let truncateLen = bestLen;
  const slice = str.substring(0, bestLen);

  const lastNewline = slice.lastIndexOf('\n');
  if (lastNewline > bestLen * 0.5) {
    truncateLen = lastNewline + 1;
  } else {
    const lastPunc = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? ')
    );
    if (lastPunc > bestLen * 0.5) {
      truncateLen = lastPunc + 1;
    } else {
      const lastSpace = slice.lastIndexOf(' ');
      if (lastSpace > bestLen * 0.7) {
        truncateLen = lastSpace + 1;
      }
    }
  }

  return {
    truncated: str.substring(0, truncateLen),
    remaining: str.substring(truncateLen)
  };
}

export function splitMessage(content: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let remaining = content;

  let loopCount = 0;
  const MAX_LOOPS = content.length;

  while (remaining.length > 0 && loopCount < MAX_LOOPS) {
    loopCount++;

    const { truncated, remaining: newRemaining } = smartTruncate(remaining, maxBytes);

    if (truncated.trim().length > 0) {
      chunks.push(truncated);
    }

    if (newRemaining === remaining) {
      const encoder = new TextEncoder();
      let len = 1;
      while (len < remaining.length && encoder.encode(remaining.substring(0, len + 1)).length <= maxBytes) {
        len++;
      }
      const forceChunk = remaining.substring(0, len);
      if (forceChunk.trim().length > 0) {
        chunks.push(forceChunk);
      }
      remaining = remaining.substring(len);
    } else {
      remaining = newRemaining;
    }
  }

  return chunks;
}