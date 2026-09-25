/**
 * 通用日历选择组件 (Calendar Picker)
 * 纯手写原生 Vanilla JS，零外部依赖
 * 遵循 Design System & better-ui 设计规范
 */

(function (window) {
  'use strict';

  // 全局唯一当前展开的日历实例 (Single Active Overlay)
  let activeCalendarPicker = null;

  /**
   * 格式化今天日期为本地 YYYY-MM-DD
   */
  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 日历选择器工厂函数
   * @param {Object} options 配置项
   */
  function createCalendarPicker(options) {
    const {
      container,
      value = '',
      placeholder = '选择日期...',
      minDate = '',
      maxDate = getLocalDateString(), // 默认最大不超过今天
      showDots = false,
      fetchDotsStatus = null, // async (month) => Record<string, { status: 'green'|'yellow'|'red'|'future', articleCount?: number }>
      allowClear = true,
      clearText = '清除',
      todayText = '今天',
      alignRight = false,
      onChange = null,
    } = options;

    const root = typeof container === 'string' ? document.querySelector(container) : container;
    if (!root) {
      console.error('[CalendarPicker] 挂载容器未找到:', container);
      return null;
    }

    let currentDate = value ? value.trim() : '';
    const today = getLocalDateString();
    let viewMonth = (currentDate || today).slice(0, 7);
    let isOpen = false;
    let dotsCache = new Map(); // month -> daysMap
    let pickerInstance = null;

    // 生成 DOM 结构
    root.classList.add('calendar-picker');
    if (showDots) {
      root.classList.add('has-dots');
    }

    root.innerHTML = `
      <button type="button" class="calendar-picker-btn filter-date" aria-haspopup="dialog" aria-expanded="false">
        <span class="calendar-picker-value ${!currentDate ? 'calendar-picker-placeholder' : ''}">
          ${currentDate || placeholder}
        </span>
        <svg class="calendar-picker-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
      </button>

      <div class="calendar-picker-dropdown ${alignRight ? 'align-right' : ''}" role="dialog" aria-modal="false" aria-label="选择日期" hidden>
        <!-- 头部年月与翻月按钮 -->
        <div class="calendar-picker-header">
          <span class="calendar-picker-month-title">--</span>
          <div class="calendar-picker-nav-btns">
            <button type="button" class="calendar-picker-nav-btn btn-prev-month" title="上一月" aria-label="上一月">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button type="button" class="calendar-picker-nav-btn btn-next-month" title="下一月" aria-label="下一月">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        </div>

        <!-- 星期表头 -->
        <div class="calendar-picker-weekdays" aria-hidden="true">
          <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
        </div>

        <!-- 日期网格 -->
        <div class="calendar-picker-days" role="grid"></div>

        <!-- 底部栏：图例（可选）+ 快捷操作 -->
        <div class="calendar-picker-footer">
          ${showDots ? `
            <div class="calendar-picker-legends" aria-label="状态图例">
              <span class="calendar-picker-legend-item"><span class="calendar-picker-dot dot-green"></span>已排序</span>
              <span class="calendar-picker-legend-item"><span class="calendar-picker-dot dot-yellow"></span>待排序</span>
              <span class="calendar-picker-legend-item"><span class="calendar-picker-dot dot-red"></span>无文章</span>
            </div>
          ` : ''}
          <div class="calendar-picker-actions">
            ${allowClear ? `<button type="button" class="calendar-picker-action-btn btn-clear">${clearText}</button>` : ''}
            <button type="button" class="calendar-picker-action-btn btn-today">${todayText}</button>
          </div>
        </div>
      </div>
    `;

    // 获取元素引用
    const triggerBtn = root.querySelector('.calendar-picker-btn');
    const valueEl = root.querySelector('.calendar-picker-value');
    const dropdown = root.querySelector('.calendar-picker-dropdown');
    const monthTitle = root.querySelector('.calendar-picker-month-title');
    const prevMonthBtn = root.querySelector('.btn-prev-month');
    const nextMonthBtn = root.querySelector('.btn-next-month');
    const daysGrid = root.querySelector('.calendar-picker-days');
    const clearBtn = root.querySelector('.btn-clear');
    const todayBtn = root.querySelector('.btn-today');

    /**
     * 打开/收起日历
     */
    function toggle(open) {
      const willOpen = typeof open === 'boolean' ? open : !isOpen;
      if (willOpen === isOpen) return;

      if (willOpen) {
        // 单例互斥：若当前有其他日历浮层已处于展开状态，自动将其关闭
        if (activeCalendarPicker && activeCalendarPicker !== pickerInstance) {
          activeCalendarPicker.close();
        }
        activeCalendarPicker = pickerInstance;
      } else {
        if (activeCalendarPicker === pickerInstance) {
          activeCalendarPicker = null;
        }
      }

      isOpen = willOpen;
      triggerBtn.setAttribute('aria-expanded', String(isOpen));

      if (isOpen) {
        dropdown.hidden = false;
        // 定位到当前选中日期的月份或当月
        viewMonth = (currentDate || today).slice(0, 7);
        // Force reflow
        void dropdown.offsetWidth;
        dropdown.classList.add('is-open');

        renderMonth(viewMonth);

        document.addEventListener('click', handleOutsideClick);
        document.addEventListener('keydown', handleKeydown);
      } else {
        dropdown.classList.remove('is-open');
        document.removeEventListener('click', handleOutsideClick);
        document.removeEventListener('keydown', handleKeydown);
        setTimeout(() => {
          if (!isOpen) {
            dropdown.hidden = true;
          }
        }, 150);
      }
    }

    function handleOutsideClick(e) {
      if (!root.contains(e.target)) {
        toggle(false);
      }
    }

    function handleKeydown(e) {
      if (e.key === 'Escape') {
        toggle(false);
        triggerBtn.focus();
      }
    }

    /**
     * 切换查看月份
     */
    function changeMonth(delta) {
      const [year, m] = viewMonth.split('-').map(Number);
      const nextDate = new Date(year, m - 1 + delta, 1);
      const nextY = nextDate.getFullYear();
      const nextM = String(nextDate.getMonth() + 1).padStart(2, '0');
      const targetMonth = `${nextY}-${nextM}`;

      // 最大月份限制
      if (maxDate && delta > 0) {
        const maxMonth = maxDate.slice(0, 7);
        if (targetMonth > maxMonth) return;
      }
      // 最小月份限制
      if (minDate && delta < 0) {
        const minMonth = minDate.slice(0, 7);
        if (targetMonth < minMonth) return;
      }

      viewMonth = targetMonth;
      renderMonth(viewMonth);
    }

    /**
     * 渲染月份视图
     */
    async function renderMonth(month) {
      const [y, m] = month.split('-');
      monthTitle.textContent = `${y}年${m}月`;

      // 翻月按钮状态
      if (maxDate) {
        const isAtMax = month >= maxDate.slice(0, 7);
        nextMonthBtn.disabled = isAtMax;
        nextMonthBtn.style.opacity = isAtMax ? '0.25' : '1';
        nextMonthBtn.style.cursor = isAtMax ? 'not-allowed' : 'pointer';
      }
      if (minDate) {
        const isAtMin = month <= minDate.slice(0, 7);
        prevMonthBtn.disabled = isAtMin;
        prevMonthBtn.style.opacity = isAtMin ? '0.25' : '1';
        prevMonthBtn.style.cursor = isAtMin ? 'not-allowed' : 'pointer';
      }

      let daysMap = {};
      if (showDots && typeof fetchDotsStatus === 'function') {
        if (dotsCache.has(month)) {
          daysMap = dotsCache.get(month);
        } else {
          try {
            daysMap = (await fetchDotsStatus(month)) || {};
            dotsCache.set(month, daysMap);
          } catch (err) {
            console.error('[CalendarPicker] 获取圆点状态失败:', err);
          }
        }
      }

      renderDaysGrid(month, daysMap);
    }

    /**
     * 渲染日期单元格网格
     */
    function renderDaysGrid(month, daysMap) {
      const [year, m] = month.split('-').map(Number);
      const firstDayOfWeek = new Date(year, m - 1, 1).getDay(); // 0 是周日
      const offset = (firstDayOfWeek + 6) % 7; // 周一为 0
      const daysInMonth = new Date(year, m, 0).getDate();
      const daysInPrevMonth = new Date(year, m - 1, 0).getDate();

      let html = '';

      // 上月填充单元格
      for (let i = offset - 1; i >= 0; i--) {
        const dayNum = daysInPrevMonth - i;
        html += `
          <div class="calendar-picker-day-cell">
            <button type="button" class="calendar-picker-day-btn is-other-month" tabindex="-1" disabled>
              <span class="calendar-picker-day-num">${dayNum}</span>
            </button>
          </div>`;
      }

      // 当月单元格
      for (let d = 1; d <= daysInMonth; d++) {
        const dayStr = String(d).padStart(2, '0');
        const dateKey = `${month}-${dayStr}`;
        const isToday = dateKey === today;
        const isSelected = dateKey === currentDate;

        // 范围限制判断
        const isBeyondMax = maxDate && dateKey > maxDate;
        const isBeforeMin = minDate && dateKey < minDate;
        const isDisabled = isBeyondMax || isBeforeMin;

        // 圆点状态处理
        let dotHtml = '';
        let statusDesc = '';

        if (showDots && !isDisabled) {
          const dayInfo = daysMap[dateKey] || { status: 'red', articleCount: 0 };
          if (dayInfo.status === 'green') {
            dotHtml = `<span class="calendar-picker-dot dot-green" aria-hidden="true"></span>`;
            statusDesc = `已评分（${dayInfo.articleCount || 0}篇）`;
          } else if (dayInfo.status === 'yellow') {
            dotHtml = `<span class="calendar-picker-dot dot-yellow" aria-hidden="true"></span>`;
            statusDesc = `待评分（${dayInfo.articleCount || 0}篇）`;
          } else if (dayInfo.status === 'red') {
            dotHtml = `<span class="calendar-picker-dot dot-red" aria-hidden="true"></span>`;
            statusDesc = '无文章';
          }
        }

        const ariaLabel = `${dateKey}${isToday ? '，今天' : ''}${statusDesc ? '，' + statusDesc : ''}`;

        html += `
          <div class="calendar-picker-day-cell">
            <button type="button"
                    class="calendar-picker-day-btn ${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''} ${isDisabled ? 'is-disabled' : ''}"
                    data-date="${dateKey}"
                    ${isDisabled ? 'disabled' : ''}
                    title="${ariaLabel}"
                    aria-label="${ariaLabel}">
              <span class="calendar-picker-day-num">${d}</span>
              ${dotHtml}
            </button>
          </div>`;
      }

      // 下月填充单元格（补齐至 7 的倍数）
      const totalRendered = offset + daysInMonth;
      const remaining = (7 - (totalRendered % 7)) % 7;
      for (let i = 1; i <= remaining; i++) {
        html += `
          <div class="calendar-picker-day-cell">
            <button type="button" class="calendar-picker-day-btn is-other-month" tabindex="-1" disabled>
              <span class="calendar-picker-day-num">${i}</span>
            </button>
          </div>`;
      }

      daysGrid.innerHTML = html;

      // 绑定单元格点击事件
      daysGrid.querySelectorAll('.calendar-picker-day-btn[data-date]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetDate = btn.dataset.date;
          if (!targetDate || btn.classList.contains('is-disabled')) return;
          selectDate(targetDate);
        });
      });
    }

    /**
     * 选择指定日期
     */
    function selectDate(newDate, triggerChange = true) {
      const isChanged = newDate !== currentDate;
      currentDate = newDate;

      // 更新按钮文本展示
      if (currentDate) {
        valueEl.textContent = currentDate;
        valueEl.classList.remove('calendar-picker-placeholder');
      } else {
        valueEl.textContent = placeholder;
        valueEl.classList.add('calendar-picker-placeholder');
      }

      toggle(false);

      if (triggerChange && isChanged && typeof onChange === 'function') {
        onChange(currentDate);
      }
    }

    /**
     * 清空日期选择
     */
    function clearDate(triggerChange = true) {
      selectDate('', triggerChange);
    }

    // 事件绑定
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    prevMonthBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMonth(-1);
    });

    nextMonthBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      changeMonth(1);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearDate(true);
      });
    }

    if (todayBtn) {
      todayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 如果今天超出 maxDate 限制则跳转到 maxDate
        const target = maxDate && today > maxDate ? maxDate : today;
        selectDate(target, true);
      });
    }

    // 实例对外公开的接口
    pickerInstance = {
      getValue: () => currentDate,
      setValue: (val, trigger = false) => selectDate(val, trigger),
      clear: (trigger = true) => clearDate(trigger),
      open: () => toggle(true),
      close: () => toggle(false),
      refreshDotsCache: () => {
        dotsCache.clear();
        if (isOpen) renderMonth(viewMonth);
      },
      destroy: () => {
        if (activeCalendarPicker === pickerInstance) {
          activeCalendarPicker = null;
        }
        document.removeEventListener('click', handleOutsideClick);
        document.removeEventListener('keydown', handleKeydown);
        root.innerHTML = '';
      }
    };

    return pickerInstance;
  }

  // 挂载到全局
  window.createCalendarPicker = createCalendarPicker;
})(window);
