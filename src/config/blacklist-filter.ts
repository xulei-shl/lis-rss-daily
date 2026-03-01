/**
 * 黑名单过滤服务
 *
 * 检查文章标题是否匹配黑名单关键词
 */

import { getTitleBlacklistKeywords } from './blacklist-config.js';

/**
 * 黑名单检查结果
 */
export interface BlacklistCheckResult {
  isBlacklisted: boolean;
  matchedKeywords: string[];
  reason?: string;
}

/**
 * 检查标题是否匹配黑名单
 * @param title - 文章标题
 * @returns 检查结果
 */
export function checkTitleBlacklist(title: string): BlacklistCheckResult {
  const keywords = getTitleBlacklistKeywords();

  if (keywords.length === 0) {
    return { isBlacklisted: false, matchedKeywords: [] };
  }

  const matchedKeywords: string[] = [];
  const lowerTitle = title.toLowerCase();

  for (const keyword of keywords) {
    if (keyword && lowerTitle.includes(keyword.toLowerCase())) {
      matchedKeywords.push(keyword);
    }
  }

  if (matchedKeywords.length > 0) {
    return {
      isBlacklisted: true,
      matchedKeywords,
      reason: `标题包含黑名单关键词: ${matchedKeywords.join(', ')}`,
    };
  }

  return { isBlacklisted: false, matchedKeywords: [] };
}
