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

/**
 * Inline Keyboard Button
 */
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
}

/**
 * Inline Keyboard Markup
 */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Telegram User
 */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Callback Query
 */
export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: {
    message_id: number;
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
  };
  data: string;
  chat_instance?: string;
}

/**
 * Telegram Message
 */
export interface Message {
  message_id: number;
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
  from?: TelegramUser;
}

/**
 * Update from Telegram getUpdates
 */
export interface TelegramUpdate {
  update_id: number;
  callback_query?: CallbackQuery;
  message?: Message;
}

/**
 * GetUpdates Response
 */
export interface GetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
  error_code?: number;
  description?: string;
}
