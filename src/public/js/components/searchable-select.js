/**
 * 可搜索下拉公共组件 (Searchable Select)
 * 纯原生 Vanilla JS，支持输入模糊检索、选中态高亮与对勾、方向键导航
 * 视觉风格与 custom-select 统一对齐，支持全局单例浮层互斥
 */

(function() {
  'use strict';

  // 全局唯一当前展开的可搜索下拉实例
  let activeSearchableSelect = null;

  function closeActiveSearchableSelect() {
    if (activeSearchableSelect) {
      activeSearchableSelect.close();
      activeSearchableSelect = null;
    }
  }

  // 暴露给其他浮层互斥调用的钩子
  window.closeActiveSearchableSelect = closeActiveSearchableSelect;

  // 点击外部收起
  document.addEventListener('click', function(e) {
    if (activeSearchableSelect && !activeSearchableSelect.container.contains(e.target)) {
      closeActiveSearchableSelect();
    }
  });

  // Esc 键收起
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && activeSearchableSelect) {
      activeSearchableSelect.close();
      activeSearchableSelect = null;
    }
  });

  /**
   * 初始化可搜索下拉框
   * @param {string|HTMLElement} containerRef
   * @param {string|HTMLElement} inputRef
   * @param {string|HTMLElement} dropdownRef
   * @param {Function} [onSelect]
   */
  function setupSearchableSelect(containerRef, inputRef, dropdownRef, onSelect) {
    const container = typeof containerRef === 'string' ? document.getElementById(containerRef) : containerRef;
    const input = typeof inputRef === 'string' ? document.getElementById(inputRef) : inputRef;
    const dropdown = typeof dropdownRef === 'string' ? document.getElementById(dropdownRef) : dropdownRef;

    if (!container || !input || !dropdown) return null;

    let selectedValue = '';
    let selectedText = '';
    let isOpen = false;

    // 创建或获取空状态提示元素
    let emptyEl = dropdown.querySelector('.select-empty');
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'select-empty';
      emptyEl.textContent = '未找到匹配来源';
      emptyEl.style.display = 'none';
      dropdown.appendChild(emptyEl);
    }

    // 更新对勾图标辅助函数
    function syncOptionSelection() {
      const options = dropdown.querySelectorAll('.select-option');
      options.forEach(opt => {
        const isSel = opt.dataset.value === selectedValue;
        opt.classList.toggle('is-selected', isSel);

        let check = opt.querySelector('.select-check');
        if (isSel) {
          if (!check) {
            check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            check.setAttribute('class', 'select-check');
            check.setAttribute('viewBox', '0 0 24 24');
            check.setAttribute('width', '14');
            check.setAttribute('height', '14');
            check.setAttribute('fill', 'none');
            check.setAttribute('stroke', 'currentColor');
            check.setAttribute('stroke-width', '2.5');
            check.setAttribute('stroke-linecap', 'round');
            check.setAttribute('stroke-linejoin', 'round');
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', '20 6 9 17 4 12');
            check.appendChild(polyline);
            opt.appendChild(check);
          }
        } else if (check) {
          check.remove();
        }
      });
    }

    function updatePosition() {
      const rect = input.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < 220 && spaceAbove > spaceBelow) {
        dropdown.classList.add('open-upward');
      } else {
        dropdown.classList.remove('open-upward');
      }
    }

    function open() {
      if (isOpen) return;
      closeActiveSearchableSelect();
      // 互斥关闭通用 select 浮层与日历
      if (typeof window.closeActiveCustomSelect === 'function') {
        window.closeActiveCustomSelect();
      }

      updatePosition();
      dropdown.style.display = 'block';
      container.classList.add('is-open');
      isOpen = true;
      activeSearchableSelect = instance;

      syncOptionSelection();

      // 定位滚动条到选中项
      const selectedOpt = dropdown.querySelector('.select-option.is-selected');
      if (selectedOpt) {
        selectedOpt.scrollIntoView({ block: 'nearest' });
      }
    }

    function close() {
      if (!isOpen) return;
      dropdown.style.display = 'none';
      container.classList.remove('is-open');
      isOpen = false;
      if (activeSearchableSelect === instance) {
        activeSearchableSelect = null;
      }
    }

    // 聚焦或点击展开
    input.addEventListener('focus', open);
    input.addEventListener('click', open);

    // 实时键入检索过滤
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      const options = dropdown.querySelectorAll('.select-option');
      let visibleCount = 0;

      options.forEach(option => {
        const text = option.textContent.toLowerCase();
        // 允许空搜索或匹配项
        if (!query || text.includes(query) || option.dataset.value === '') {
          option.style.display = 'flex';
          visibleCount++;
        } else {
          option.style.display = 'none';
        }
      });

      emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
      open();
    });

    // 点击选项触发选择
    dropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.select-option');
      if (!option) return;

      selectedValue = option.dataset.value || '';
      // 提取选项文本（去除可能存在的对勾图标文本）
      const textNode = Array.from(option.childNodes).find(n => n.nodeType === 3);
      selectedText = textNode ? textNode.textContent.trim() : (option.innerText || '').trim();

      input.value = selectedText;
      syncOptionSelection();
      close();

      // 恢复所有选项可见状态
      dropdown.querySelectorAll('.select-option').forEach(opt => opt.style.display = 'flex');
      emptyEl.style.display = 'none';

      if (onSelect) onSelect(selectedValue);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 键盘上下选择与回车确认
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        const visibleOptions = Array.from(dropdown.querySelectorAll('.select-option')).filter(opt => opt.style.display !== 'none');
        if (visibleOptions.length === 0) return;

        let currentIndex = visibleOptions.findIndex(el => el.classList.contains('is-focused') || el.classList.contains('is-selected'));

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (!isOpen) open();
          currentIndex = (currentIndex + 1) % visibleOptions.length;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (!isOpen) open();
          currentIndex = (currentIndex - 1 + visibleOptions.length) % visibleOptions.length;
        } else if (e.key === 'Enter') {
          if (isOpen && currentIndex >= 0 && visibleOptions[currentIndex]) {
            e.preventDefault();
            visibleOptions[currentIndex].click();
            return;
          }
        }
        visibleOptions.forEach((el, i) => {
          el.classList.toggle('is-focused', i === currentIndex);
          if (i === currentIndex) el.scrollIntoView({ block: 'nearest' });
        });
      }
    });

    // 观察 dropdown 的子节点变动（如 loadSources 动态填充 options 后保持同步）
    const observer = new MutationObserver(() => {
      if (!dropdown.contains(emptyEl)) {
        dropdown.appendChild(emptyEl);
      }
      syncOptionSelection();
    });
    observer.observe(dropdown, { childList: true });

    const instance = {
      container,
      input,
      dropdown,
      open,
      close,
      getSelectedValue: () => selectedValue,
      setSelectedValue: (val) => {
        selectedValue = val || '';
        const opt = dropdown.querySelector(`.select-option[data-value="${selectedValue}"]`);
        if (opt) {
          const textNode = Array.from(opt.childNodes).find(n => n.nodeType === 3);
          selectedText = textNode ? textNode.textContent.trim() : (opt.innerText || '').trim();
          input.value = selectedText;
        } else if (!selectedValue) {
          input.value = '';
        }
        syncOptionSelection();
      }
    };

    // 绑定至 input 元素兼容旧有代码直接访问
    input.getSelectedValue = instance.getSelectedValue;
    input.setSelectedValue = instance.setSelectedValue;
    input.__searchableSelectInstance = instance;

    return instance;
  }

  // 暴露全局 API
  window.setupSearchableSelect = setupSearchableSelect;
  window.createSearchableSelect = setupSearchableSelect;
})();
