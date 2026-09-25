/**
 * 通用自定义下拉组件 (Custom Select)
 * 纯原生 Vanilla JS，将原生 <select> 无侵入增强为统一的圆角矩形弹出浮层
 * 视觉对齐 articles 页面「来源」下拉框与通用日历组件规范
 */

(function() {
  'use strict';

  // 全局唯一当前展开的自定义下拉实例 (Single Active Overlay)
  let activeCustomSelect = null;

  function closeActiveSelect() {
    if (activeCustomSelect) {
      activeCustomSelect.close();
      activeCustomSelect = null;
    }
  }

  // 暴露给其他浮层互斥调用的钩子
  window.closeActiveCustomSelect = closeActiveSelect;

  // 点击外部收起
  document.addEventListener('click', function(e) {
    if (activeCustomSelect && !activeCustomSelect.wrapper.contains(e.target)) {
      closeActiveSelect();
    }
  });

  // Esc 键收起
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && activeCustomSelect) {
      activeCustomSelect.close();
      activeCustomSelect = null;
    }
  });

  /**
   * 增强单个原生 <select>
   */
  function enhanceSelect(select) {
    if (!select || select.nodeType !== 1 || select.tagName !== 'SELECT') return null;
    if (select.dataset.customEnhanced === 'true') return select.__customSelectInstance || null;
    if (select.hasAttribute('data-no-custom') || select.classList.contains('no-custom-select')) return null;
    if (select.multiple) return null; // 保持原生多选

    select.dataset.customEnhanced = 'true';

    // 1. 创建外层容器
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    if (select.id) {
      wrapper.id = select.id + '_custom_wrapper';
    }

    // 保留关键尺寸与外层布局
    if (select.style.width) wrapper.style.width = select.style.width;
    if (select.style.flex) wrapper.style.flex = select.style.flex;
    if (select.style.maxWidth) wrapper.style.maxWidth = select.style.maxWidth;

    // 2. 创建触发按钮
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';

    // 继承原生 select 的 class（例如 filter-select, form-control 等），保证排版样式无缝生效
    Array.from(select.classList).forEach(cls => {
      if (cls && cls !== 'custom-select-native') {
        trigger.classList.add(cls);
      }
    });

    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (select.disabled) trigger.disabled = true;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'custom-select-value';

    // 箭头 SVG 图标
    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.setAttribute('class', 'custom-select-arrow');
    arrowSvg.setAttribute('viewBox', '0 0 24 24');
    arrowSvg.setAttribute('fill', 'none');
    arrowSvg.setAttribute('stroke', 'currentColor');
    arrowSvg.setAttribute('stroke-width', '2');
    arrowSvg.setAttribute('stroke-linecap', 'round');
    arrowSvg.setAttribute('stroke-linejoin', 'round');
    arrowSvg.setAttribute('aria-hidden', 'true');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '6 9 12 15 18 9');
    arrowSvg.appendChild(polyline);

    trigger.appendChild(valueSpan);
    trigger.appendChild(arrowSvg);

    // 3. 创建下拉浮层
    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.hidden = true;

    // 4. 将 wrapper 插入 DOM，收纳 select
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);

    select.classList.add('custom-select-native');

    // 实例对象
    const instance = {
      select,
      wrapper,
      trigger,
      dropdown,
      valueSpan,
      isOpen: false,

      open() {
        if (this.isOpen || this.select.disabled) return;
        closeActiveSelect();

        // 互斥关闭可能展开的可搜索下拉
        if (typeof window.closeActiveSearchableSelect === 'function') {
          window.closeActiveSearchableSelect();
        } else {
          const sourceDropdown = document.getElementById('sourceDropdown');
          if (sourceDropdown && sourceDropdown.style.display !== 'none') {
            sourceDropdown.style.display = 'none';
          }
        }

        // 触发原生 select 的 onfocus（兼容 settings 页面等动态载入 options 的场景）
        try {
          if (typeof this.select.onfocus === 'function') {
            this.select.onfocus();
          }
          this.select.dispatchEvent(new Event('focus'));
        } catch (e) {
          // ignore focus error
        }

        this.renderOptions();
        this.updatePosition();

        this.isOpen = true;
        this.dropdown.hidden = false;
        this.wrapper.classList.add('is-open');
        this.trigger.setAttribute('aria-expanded', 'true');
        activeCustomSelect = this;

        // 滚动定位到当前选中项
        const selectedOpt = this.dropdown.querySelector('.custom-select-option.is-selected');
        if (selectedOpt) {
          selectedOpt.scrollIntoView({ block: 'nearest' });
        }
      },

      close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.dropdown.hidden = true;
        this.wrapper.classList.remove('is-open');
        this.trigger.setAttribute('aria-expanded', 'false');
        if (activeCustomSelect === this) {
          activeCustomSelect = null;
        }
      },

      toggle() {
        if (this.isOpen) {
          this.close();
        } else {
          this.open();
        }
      },

      updatePosition() {
        const rect = this.trigger.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        // 如果下方空间小于 220px 且上方空间大于下方空间，则向上展开
        if (spaceBelow < 220 && spaceAbove > spaceBelow) {
          this.dropdown.classList.add('open-upward');
        } else {
          this.dropdown.classList.remove('open-upward');
        }
      },

      updateDisplay() {
        const selectedOption = this.select.options[this.select.selectedIndex];
        if (selectedOption) {
          this.valueSpan.textContent = selectedOption.textContent || selectedOption.value || '';
          if (!selectedOption.value) {
            this.valueSpan.classList.add('is-placeholder');
          } else {
            this.valueSpan.classList.remove('is-placeholder');
          }
        } else {
          this.valueSpan.textContent = '';
        }
      },

      renderOptions() {
        this.dropdown.innerHTML = '';
        const options = Array.from(this.select.options);
        const currentVal = this.select.value;

        options.forEach((opt, idx) => {
          const optEl = document.createElement('div');
          optEl.className = 'custom-select-option';
          optEl.setAttribute('role', 'option');
          optEl.dataset.value = opt.value;
          optEl.dataset.index = String(idx);
          optEl.textContent = opt.textContent;

          if (opt.disabled) {
            optEl.classList.add('is-disabled');
          }

          if (opt.value === currentVal || (currentVal === '' && opt.selected)) {
            optEl.classList.add('is-selected');
            optEl.setAttribute('aria-selected', 'true');

            // 选中状态添加精美对勾图标
            const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            check.setAttribute('class', 'custom-select-check');
            check.setAttribute('viewBox', '0 0 24 24');
            check.setAttribute('width', '14');
            check.setAttribute('height', '14');
            check.setAttribute('fill', 'none');
            check.setAttribute('stroke', 'currentColor');
            check.setAttribute('stroke-width', '2.5');
            check.setAttribute('stroke-linecap', 'round');
            check.setAttribute('stroke-linejoin', 'round');
            const chkPolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            chkPolyline.setAttribute('points', '20 6 9 17 4 12');
            check.appendChild(chkPolyline);
            optEl.appendChild(check);
          }

          optEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (opt.disabled) return;
            this.selectOption(opt.value);
          });

          this.dropdown.appendChild(optEl);
        });

        this.updateDisplay();
      },

      selectOption(val) {
        if (this.select.value !== val) {
          this.select.value = val;
          // 派发原生标准冒泡 change 和 input 事件，确保与外部所有既有监听器完全互通
          this.select.dispatchEvent(new Event('change', { bubbles: true }));
          this.select.dispatchEvent(new Event('input', { bubbles: true }));
        }
        this.updateDisplay();
        this.close();
        this.trigger.focus();
      }
    };

    select.__customSelectInstance = instance;

    // 初始渲染显示文本
    instance.updateDisplay();

    // 触发器点击切换
    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      instance.toggle();
    });

    // 键盘无障碍支持 (Enter / Space / 方向键 / Esc)
    trigger.addEventListener('keydown', function(e) {
      if (select.disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!instance.isOpen) {
          instance.open();
        } else {
          const options = Array.from(instance.dropdown.querySelectorAll('.custom-select-option:not(.is-disabled)'));
          if (options.length === 0) return;

          let currentIndex = options.findIndex(el => el.classList.contains('is-focused') || el.classList.contains('is-selected'));
          if (e.key === 'ArrowDown') {
            currentIndex = (currentIndex + 1) % options.length;
          } else if (e.key === 'ArrowUp') {
            currentIndex = (currentIndex - 1 + options.length) % options.length;
          } else if (e.key === 'Enter' || e.key === ' ') {
            if (currentIndex >= 0 && options[currentIndex]) {
              options[currentIndex].click();
            }
            return;
          }
          options.forEach((el, i) => {
            el.classList.toggle('is-focused', i === currentIndex);
            if (i === currentIndex) el.scrollIntoView({ block: 'nearest' });
          });
        }
      }
    });

    // 劫持 value 与 selectedIndex，保证外部 JS 代码直接赋值 `select.value = 'xxx'` 时触发器自动更新
    const origValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (origValueDescriptor) {
      Object.defineProperty(select, 'value', {
        get() {
          return origValueDescriptor.get.call(this);
        },
        set(val) {
          origValueDescriptor.set.call(this, val);
          instance.updateDisplay();
        },
        configurable: true
      });
    }

    const origIdxDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    if (origIdxDescriptor) {
      Object.defineProperty(select, 'selectedIndex', {
        get() {
          return origIdxDescriptor.get.call(this);
        },
        set(idx) {
          origIdxDescriptor.set.call(this, idx);
          instance.updateDisplay();
        },
        configurable: true
      });
    }

    // 监听原生 select 的 change 事件（如从外部派发）
    select.addEventListener('change', function() {
      instance.updateDisplay();
      trigger.classList.remove('is-invalid');
    });

    // 原生聚焦时将焦点转给 trigger 按钮
    select.addEventListener('focus', function() {
      trigger.focus();
    });

    // 表单验证非法时高亮 trigger
    select.addEventListener('invalid', function() {
      trigger.classList.add('is-invalid');
    });

    // 监听原生 select 子节点及属性变动（如 options 异步动态载入或 disabled 状态切换）
    const observer = new MutationObserver(function(mutations) {
      for (const m of mutations) {
        if (m.type === 'childList') {
          instance.updateDisplay();
          if (instance.isOpen) {
            instance.renderOptions();
          }
        } else if (m.type === 'attributes') {
          if (m.attributeName === 'disabled') {
            trigger.disabled = select.disabled;
          }
        }
      }
    });
    observer.observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });

    return instance;
  }

  /**
   * 初始化指定容器或全文档中的 select
   */
  function initCustomSelects(root = document) {
    if (!root || !root.querySelectorAll) return;
    const selects = root.querySelectorAll('select');
    selects.forEach(sel => {
      enhanceSelect(sel);
    });
  }

  // 监听动态插入的 DOM 元素（如动态弹出的 modal、异步加载的 panel）
  const bodyObserver = new MutationObserver(function(mutations) {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) { // ELEMENT_NODE
          if (node.tagName === 'SELECT') {
            enhanceSelect(node);
          } else if (node.querySelectorAll) {
            initCustomSelects(node);
          }
        }
      }
    }
  });

  // DOM 就绪后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initCustomSelects();
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    initCustomSelects();
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  // 暴露全局 API
  window.enhanceSelect = enhanceSelect;
  window.initCustomSelects = initCustomSelects;
})();
