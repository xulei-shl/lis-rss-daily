(function (global) {
  'use strict';

  // 使用 Asia/Shanghai 时区，确保正确显示北京时间
  const TIME_ZONE = 'Asia/Shanghai';

  function parseDate(input) {
    if (!input) return null;
    if (input instanceof Date) {
      return Number.isNaN(input.getTime()) ? null : input;
    }
    // 兼容 SQLite 空格分隔格式 (YYYY-MM-DD HH:MM:SS) 与已有带时区偏移 (+08:00) 的格式
    const str = typeof input === 'string' ? input.trim().replace(' ', 'T') : String(input);
    const hasTz = str.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(str);
    const date = new Date(str + (hasTz ? '' : 'Z'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatWithOptions(date, options) {
    if (!date) return '';
    const formatOptions = {
      hour12: false,
      ...options,
    };
    // 只有时区被显式设置时才添加（支持浏览器本地时区）
    if (TIME_ZONE) {
      formatOptions.timeZone = TIME_ZONE;
    }
    const formatter = new Intl.DateTimeFormat('zh-CN', formatOptions);
    return formatter.format(date);
  }

  function formatDateTime(input, overrides = {}) {
    const date = parseDate(input);
    return formatWithOptions(date, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...overrides,
    });
  }

  function formatDate(input, overrides = {}) {
    const date = parseDate(input);
    return formatWithOptions(date, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...overrides,
    });
  }

  function formatMonthDayTime(input) {
    const date = parseDate(input);
    return formatWithOptions(date, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatTimeOfDay(input) {
    const date = parseDate(input);
    return formatWithOptions(date, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatRelativeTime(input, fallbackOptions) {
    const date = parseDate(input);
    if (!date) return '';

    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';

    return formatWithOptions(date, fallbackOptions || {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  global.timeUtils = {
    timeZone: TIME_ZONE || 'local',
    formatDateTime,
    formatDate,
    formatMonthDayTime,
    formatTimeOfDay,
    formatRelativeTime,
  };
})(window);
