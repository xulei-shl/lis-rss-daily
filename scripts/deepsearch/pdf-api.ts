import { getConfig } from './config.js';
import type { PdfApiResult } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callPdfApi(
  title: string,
  articleId: number | null
): Promise<PdfApiResult> {
  const config = getConfig();
  const apiUrl = config.pdf_summary.api_url;
  const timeout = config.pdf_summary.timeout * 1000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const requestBody: Record<string, any> = {
      title,
    };

    if (articleId !== null) {
      requestBody.id = articleId;
    }

    const response = await fetch(`${apiUrl}/summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        reason: `API returned ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.success) {
      return {
        success: true,
        md_path: data.md_path,
        pdf_path: data.pdf_path,
      };
    } else {
      return {
        success: false,
        reason: data.error || 'Unknown error',
      };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('aborted')) {
      return {
        success: false,
        reason: 'Request timeout',
      };
    }
    return {
      success: false,
      reason: errorMessage,
    };
  }
}

export async function callPdfApiWithRetry(
  title: string,
  articleId: number | null
): Promise<PdfApiResult> {
  const config = getConfig();
  const maxRetries = config.pdf_summary.max_retries;
  const baseDelay = config.llm.retry_delay_ms;

  let lastError: PdfApiResult = { success: false, reason: 'Unknown error' };

  for (let i = 0; i < maxRetries; i++) {
    const result = await callPdfApi(title, articleId);
    
    if (result.success) {
      return result;
    }

    lastError = result;

    if (i < maxRetries - 1) {
      const delay = baseDelay * Math.pow(2, i);
      console.warn(`[重试] PDF API 调用失败: ${result.reason}，${delay}ms 后重试 (${i + 1}/${maxRetries})`);
      await sleep(delay);
    }
  }

  console.error(`[错误] PDF API 调用失败，已达最大重试次数: ${lastError.reason}`);
  return lastError;
}