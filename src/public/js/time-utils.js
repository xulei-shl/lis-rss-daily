(function (global) {
  'use strict';

  const TIME_ZONE = 'Asia/Shanghai';

  function parseDate(input) {
    if (!input) return null;
    if (input instanceof Date) {
      return Number.isNaN(input.getTime()) ? null : input;
    }
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatWithOptions(date, options) {
    if (!date) return '';
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: TIME_ZONE,
      hour12: false,
      ...options,
    });
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
    timeZone: TIME_ZONE,
    formatDateTime,
    formatDate,
    formatMonthDayTime,
    formatTimeOfDay,
    formatRelativeTime,
  };
})(window);
