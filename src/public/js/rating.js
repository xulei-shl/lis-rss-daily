/**
 * Rating Component
 * 文章星级评分组件
 */

const RatingComponent = {
  /**
   * 渲染只读评级显示
   * @param {number|null} rating - 当前评级（1-5 或 null）
   * @returns {string} HTML 字符串
   */
  renderDisplay(rating) {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
      const filled = rating !== null && i <= rating ? 'filled' : '';
      stars += `<span class="rating-star ${filled}">★</span>`;
    }
    return `<span class="rating-container rating-display">${stars}</span>`;
  },

  /**
   * 渲染交互式评级输入
   * @param {number} articleId - 文章 ID
   * @param {number|null} rating - 当前评级（1-5 或 null）
   * @param {boolean} isGuest - 是否为访客模式
   * @returns {string} HTML 字符串
   */
  renderInput(articleId, rating, isGuest = false) {
    // guest 只显示只读模式
    if (isGuest) {
      return this.renderDisplay(rating);
    }

    let stars = '';
    for (let i = 1; i <= 5; i++) {
      const filled = rating !== null && i <= rating ? 'filled' : '';
      stars += `<span class="rating-star ${filled}" data-rating="${i}">★</span>`;
    }

    const clearBtn = rating !== null
      ? '<span class="rating-clear" title="清除评级">×</span>'
      : '';

    return `<span class="rating-container rating-input" data-article-id="${articleId}" data-current-rating="${rating ?? ''}">${stars}${clearBtn}</span>`;
  },

  /**
   * 更新评级
   * @param {number} articleId - 文章 ID
   * @param {number|null} rating - 新评级（1-5 或 null）
   * @returns {Promise<boolean>}
   */
  async updateRating(articleId, rating) {
    try {
      const response = await fetch(`/api/articles/${articleId}/rating`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rating }),
      });

      if (!response.ok) {
        throw new Error('Failed to update rating');
      }

      return true;
    } catch (error) {
      console.error('Failed to update rating:', error);
      return false;
    }
  },

  /**
   * 初始化评级输入事件监听
   */
  initInputs() {
    document.addEventListener('click', async (e) => {
      const star = e.target.closest('.rating-star');
      const clearBtn = e.target.closest('.rating-clear');

      if (clearBtn) {
        const container = clearBtn.closest('.rating-container');
        if (!container) return;

        const articleId = parseInt(container.dataset.articleId, 10);
        const success = await this.updateRating(articleId, null);

        if (success) {
          // 更新 UI
          container.outerHTML = this.renderInput(articleId, null, false);
        }
        return;
      }

      if (star) {
        const container = star.closest('.rating-container');
        if (!container || container.classList.contains('rating-display')) return;

        const articleId = parseInt(container.dataset.articleId, 10);
        const clickedRating = parseInt(star.dataset.rating, 10);
        const currentRating = parseInt(container.dataset.currentRating, 10) || 0;

        // 点击当前已评级的星级 -> 取消评级（toggle 行为）
        const newRating = (currentRating === clickedRating) ? null : clickedRating;
        const success = await this.updateRating(articleId, newRating);

        if (success) {
          // 打标时自动触发已读状态 UI 更新
          if (newRating !== null) {
            const card = document.querySelector(`[data-article-id="${articleId}"]`);
            // 首页未读文章打标后淡出移除
            if (card && card.classList.contains('article-card') && !card.classList.contains('is-read')) {
              if (typeof window.fadeOutAndRemoveCard === 'function') {
                window.fadeOutAndRemoveCard(card);
              } else {
                // 如果没有淡出函数，添加已读样式
                card.classList.add('is-read');
              }
            }
          }

          // 更新评级 UI
          container.outerHTML = this.renderInput(articleId, newRating, false);
        }
      }
    });

    // 悬停效果
    document.addEventListener('mouseover', (e) => {
      const star = e.target.closest('.rating-star');
      if (!star) return;

      const container = star.closest('.rating-container');
      if (!container || container.classList.contains('rating-display')) return;

      const hoverRating = parseInt(star.dataset.rating, 10);
      const stars = container.querySelectorAll('.rating-star');

      stars.forEach((s, index) => {
        if (index < hoverRating) {
          s.classList.add('active');
        } else {
          s.classList.remove('active');
        }
      });
    });

    document.addEventListener('mouseout', (e) => {
      const star = e.target.closest('.rating-star');
      if (!star) return;

      const container = star.closest('.rating-container');
      if (!container || container.classList.contains('rating-display')) return;

      const currentRating = parseInt(container.dataset.currentRating, 10) || 0;
      const stars = container.querySelectorAll('.rating-star');

      stars.forEach((s, index) => {
        s.classList.remove('active');
        if (index < currentRating) {
          s.classList.add('filled');
        } else {
          s.classList.remove('filled');
        }
      });
    });
  }
};

// 导出全局函数
window.renderRatingDisplay = RatingComponent.renderDisplay.bind(RatingComponent);
window.renderRatingInput = RatingComponent.renderInput.bind(RatingComponent);

// 自动初始化事件监听（使用事件委托，无需等待 DOM）
RatingComponent.initInputs();
