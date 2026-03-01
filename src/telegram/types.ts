/**
 * Telegram Module Types
 */

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  dailySummary: boolean;
  newArticles: boolean;
}

export interface DailySummaryData {
  date: string;
  type: 'journal' | 'blog_news' | 'all';
  totalArticles: number;
  summary: string;
  articlesByType: {
    journal: number;
    blog: number;
    news: number;
  };
}

export interface TelegramMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
  };
  error_code?: number;
  description?: string;
}
