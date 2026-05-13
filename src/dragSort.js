import { CONSTANTS } from './utils.js';

const CHARGE_START_DELAY_MS = 80;
const TILT_MAX_DEG = 6;
const TILT_VELOCITY_GAIN = 60;
const TILT_SMOOTH = 0.2;
const LANDING_MS = 200;
const SETTLE_MS = 240;
const INDICATOR_WIDTH = 3;
const FLIP_MS = 260;
const TRASH_EXIT_MS = 260;

export class DragSort {
  constructor({ photoWall, onReorder, onRemove }) {
    this.photoWall = photoWall;
    this.onReorder = onReorder;
    this.onRemove = onRemove;

    this.state = null;
    this.cloneWrap = null;
    this.cloneInner = null;
    this.indicator = null;
    this.trashZone = null;
    this.target = null;
    this.dropMode = 'reorder';
    this.draggedEl = null;
    this.updatePending = false;
    this._consumedClick = false;

    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  get isDragging() {
    return Boolean(this.draggedEl);
  }

  attach(container) {
    container.draggable = false;
    container.addEventListener('pointerdown', (e) => this._onPointerDown(e, container));
    container.addEventListener('click', (e) => {
      if (this.isDragging || this._consumedClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  _onPointerDown(e, container) {
    if (this.state || this.isDragging) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();

    container.classList.add('is-pressed');

    this.state = {
      container,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      startRect: null,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      currentTilt: 0,
      chargeStartTimer: setTimeout(() => this._beginCharging(), CHARGE_START_DELAY_MS),
      longPressTimer: setTimeout(() => this._beginDrag(), CONSTANTS.LONG_PRESS_MS),
    };

    try { container.setPointerCapture?.(e.pointerId); } catch {}
    document.addEventListener('pointermove', this._onMove);
    document.addEventListener('pointerup', this._onUp);
    document.addEventListener('pointercancel', this._onUp);
  }

  _beginCharging() {
    if (!this.state || this.isDragging) return;
    const { container } = this.state;
    container.classList.remove('is-pressed');
    container.classList.add('is-charging');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.state?.container === container && !this.isDragging) {
          container.classList.add('is-filled');
        }
      });
    });
  }

  _onMove(e) {
    if (!this.state || e.pointerId !== this.state.pointerId) return;

    if (!this.isDragging) {
      const dx = Math.abs(e.clientX - this.state.startX);
      const dy = Math.abs(e.clientY - this.state.startY);
      if (dx > CONSTANTS.DRAG_CANCEL_DISTANCE || dy > CONSTANTS.DRAG_CANCEL_DISTANCE) {
        this._cancelPress();
      }
      return;
    }

    e.preventDefault();
    this._updateClone(e.clientX, e.clientY, false);

    if (!this.updatePending) {
      this.updatePending = true;
      const x = e.clientX;
      const y = e.clientY;
      requestAnimationFrame(() => {
        this._updateDropTarget(x, y);
        this.updatePending = false;
      });
    }
  }

  _onUp(e) {
    if (!this.state || e.pointerId !== this.state.pointerId) return;
    if (this.isDragging) {
      this._release();
    } else {
      this._cancelPress();
    }
  }

  _beginDrag() {
    if (!this.state) return;
    const { container, startX, startY, pointerType } = this.state;
    const rect = container.getBoundingClientRect();
    this.state.startRect = rect;

    if (pointerType !== 'mouse') {
      try { navigator.vibrate?.([12, 28, 16]); } catch {}
    }

    container.classList.remove('is-pressed', 'is-charging', 'is-filled');

    const wrap = document.createElement('div');
    wrap.className = 'is-clone';
    wrap.style.width = `${rect.width}px`;
    wrap.style.height = `${rect.height}px`;
    wrap.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;

    const inner = container.cloneNode(true);
    inner.classList.add('is-clone-inner');
    inner.classList.remove('is-pressed', 'is-charging', 'is-filled', 'is-source', 'is-settling', 'is-incoming');
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    this.cloneWrap = wrap;
    this.cloneInner = inner;

    const indicator = document.createElement('div');
    indicator.className = 'is-drop-indicator is-hidden';
    document.body.appendChild(indicator);
    this.indicator = indicator;

    const trash = document.createElement('div');
    trash.className = 'drag-trash-zone';
    const trashIcon = document.createElement('span');
    trashIcon.className = 'drag-trash-icon';
    trashIcon.setAttribute('aria-hidden', 'true');
    trashIcon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/></svg>';
    const trashText = document.createElement('span');
    trashText.className = 'drag-trash-text';
    trashText.textContent = '拖到这里移除';
    trash.appendChild(trashIcon);
    trash.appendChild(trashText);
    document.body.appendChild(trash);
    this.trashZone = trash;
    this._trashText = trashText;

    container.classList.add('is-source');
    this.draggedEl = container;
    this.target = null;
    this.dropMode = 'reorder';

    document.body.classList.add('drag-context');

    requestAnimationFrame(() => {
      inner.classList.add('is-lifting');
    });

    this._updateClone(startX, startY, true);
  }

  _updateClone(x, y, initial) {
    const wrap = this.cloneWrap;
    const inner = this.cloneInner;
    if (!wrap) return;
    const w = wrap.offsetWidth / 2;
    const h = wrap.offsetHeight / 2;
    wrap.style.transform = `translate3d(${x - w}px, ${y - h}px, 0)`;

    if (initial || !this.state || !inner) return;

    const t = performance.now();
    const dt = Math.max(t - this.state.lastT, 1);
    const vx = (x - this.state.lastX) / dt;
    let target = vx * TILT_VELOCITY_GAIN;
    if (target > TILT_MAX_DEG) target = TILT_MAX_DEG;
    else if (target < -TILT_MAX_DEG) target = -TILT_MAX_DEG;
    const next = this.state.currentTilt + (target - this.state.currentTilt) * TILT_SMOOTH;
    this.state.currentTilt = next;
    inner.style.setProperty('--tilt', `${next.toFixed(2)}deg`);

    this.state.lastX = x;
    this.state.lastY = y;
    this.state.lastT = t;
  }

  _updateDropTarget(x, y) {
    if (this._isInTrashZone(x, y)) {
      if (this.dropMode !== 'trash') {
        this.dropMode = 'trash';
        this.indicator?.classList.add('is-hidden');
        this.trashZone?.classList.add('is-active');
        this.cloneWrap?.classList.add('is-over-trash');
        if (this._trashText) this._trashText.textContent = '释放即删除';
      }
      return;
    }

    if (this.dropMode !== 'reorder') {
      this.dropMode = 'reorder';
      this.trashZone?.classList.remove('is-active');
      this.cloneWrap?.classList.remove('is-over-trash');
      if (this._trashText) this._trashText.textContent = '拖到这里移除';
    }

    this._updateInsertionTarget(x, y);
  }

  _isInTrashZone(x, y) {
    if (!this.trashZone) return false;
    const r = this.trashZone.getBoundingClientRect();
    if (r.width === 0) return false;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  _updateInsertionTarget(x, y) {
    if (!this.indicator || !this.draggedEl) return;
    const candidates = [...this.photoWall.querySelectorAll('.photo-container')].filter(
      (el) => el !== this.draggedEl && el.style.display !== 'none'
    );
    if (candidates.length === 0) {
      this.indicator.classList.add('is-hidden');
      this.target = null;
      return;
    }

    let best = null;
    let bestDist = Infinity;
    let bestRect = null;
    let insertAfter = false;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestDist) {
        bestDist = d;
        best = el;
        bestRect = r;
        insertAfter = x > cx;
      }
    }
    if (!best) {
      this.indicator.classList.add('is-hidden');
      this.target = null;
      return;
    }

    this.target = { el: best, insertAfter };
    this._positionIndicator(bestRect, insertAfter);
  }

  _positionIndicator(rect, insertAfter) {
    const ind = this.indicator;
    if (!ind) return;
    const gap = this._gridColumnGap();
    const halfGap = gap / 2;
    const edgeX = insertAfter ? rect.right + halfGap : rect.left - halfGap;
    const x = edgeX - INDICATOR_WIDTH / 2;
    const y = rect.top;
    const h = rect.height;
    ind.style.width = `${INDICATOR_WIDTH}px`;
    ind.style.height = `${h}px`;
    ind.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    ind.classList.remove('is-hidden');
  }

  _gridColumnGap() {
    const cs = getComputedStyle(this.photoWall);
    const g = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 10;
    return g;
  }

  _release() {
    document.removeEventListener('pointermove', this._onMove);
    document.removeEventListener('pointerup', this._onUp);
    document.removeEventListener('pointercancel', this._onUp);

    this._consumedClick = true;
    setTimeout(() => { this._consumedClick = false; }, 320);

    this.indicator?.classList.add('is-hidden');

    if (this.dropMode === 'trash') {
      this._releaseToTrash();
    } else {
      this._releaseReorder();
    }
  }

  _releaseReorder() {
    const wrap = this.cloneWrap;
    const inner = this.cloneInner;
    const dragged = this.draggedEl;
    const target = this.target;

    if (!wrap || !dragged) {
      this._finalize(false);
      return;
    }

    if (target && target.el !== dragged) {
      const siblings = [...this.photoWall.querySelectorAll('.photo-container')];
      const olds = new Map(siblings.map((el) => [el, el.getBoundingClientRect()]));

      dragged.classList.remove('is-source');
      dragged.classList.add('is-incoming');

      const ref = target.insertAfter ? target.el.nextSibling : target.el;
      if (ref !== dragged && ref !== dragged.nextSibling) {
        target.el.parentNode.insertBefore(dragged, ref);
        this.onReorder?.();
      }

      void this.photoWall.offsetHeight;
      this._flipPlay(siblings, olds);
    } else {
      dragged.classList.remove('is-source');
      dragged.classList.add('is-incoming');
      void dragged.offsetHeight;
    }

    const targetRect = dragged.getBoundingClientRect();

    wrap.classList.add('is-landing');
    inner.classList.remove('is-lifting');
    inner.style.setProperty('--tilt', '0deg');

    requestAnimationFrame(() => {
      wrap.style.transform = `translate3d(${targetRect.left}px, ${targetRect.top}px, 0)`;
    });

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this._finalize(true);
    };
    wrap.addEventListener('transitionend', (ev) => {
      if (ev.propertyName === 'transform') finish();
    });
    setTimeout(finish, LANDING_MS + 80);
  }

  async _releaseToTrash() {
    const wrap = this.cloneWrap;
    const inner = this.cloneInner;
    const dragged = this.draggedEl;
    const startRect = this.state?.startRect;

    if (!wrap || !dragged) {
      this._finalize(false);
      return;
    }

    this.trashZone?.classList.add('is-pending');
    const name = dragged.dataset?.name ?? '这张图片';
    const ok = await this._confirmDelete(name);

    if (ok) {
      const siblings = [...this.photoWall.querySelectorAll('.photo-container')]
        .filter((el) => el !== dragged);
      const olds = new Map(siblings.map((el) => [el, el.getBoundingClientRect()]));

      const removed = dragged;
      this.draggedEl = null;
      removed.remove();

      void this.photoWall.offsetHeight;
      this._flipPlay(siblings, olds);

      wrap.classList.add('is-vanishing');

      const finish = () => {
        this._finalize(false);
        this.onRemove?.();
      };
      let done = false;
      const onEnd = () => {
        if (done) return;
        done = true;
        finish();
      };
      wrap.addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, TRASH_EXIT_MS + 60);
      return;
    }

    wrap.classList.remove('is-over-trash');
    this.trashZone?.classList.remove('is-active');
    wrap.classList.add('is-landing');
    inner.classList.remove('is-lifting');
    inner.style.setProperty('--tilt', '0deg');

    requestAnimationFrame(() => {
      if (startRect) {
        wrap.style.transform = `translate3d(${startRect.left}px, ${startRect.top}px, 0)`;
      }
    });

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this._finalize(false);
    };
    wrap.addEventListener('transitionend', (ev) => {
      if (ev.propertyName === 'transform') finish();
    });
    setTimeout(finish, LANDING_MS + 80);
  }

  _confirmDelete(name) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'drag-confirm-overlay';

      const card = document.createElement('div');
      card.className = 'drag-confirm-card';

      const title = document.createElement('div');
      title.className = 'drag-confirm-title';
      title.textContent = '从列表中移除？';

      const nameEl = document.createElement('div');
      nameEl.className = 'drag-confirm-name';
      nameEl.textContent = name;

      const actions = document.createElement('div');
      actions.className = 'drag-confirm-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'drag-confirm-cancel';
      cancelBtn.textContent = '取消';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'drag-confirm-ok';
      okBtn.textContent = '移除';

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      card.appendChild(title);
      card.appendChild(nameEl);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      requestAnimationFrame(() => overlay.classList.add('is-visible'));

      let settled = false;
      const close = (val) => {
        if (settled) return;
        settled = true;
        overlay.classList.remove('is-visible');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => overlay.remove(), 200);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        else if (e.key === 'Enter') close(true);
      };
      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', onKey);

      requestAnimationFrame(() => okBtn.focus());
    });
  }

  _flipPlay(items, oldRects) {
    const animated = [];
    for (const el of items) {
      const oldR = oldRects.get(el);
      if (!oldR) continue;
      const newR = el.getBoundingClientRect();
      const dx = oldR.left - newR.left;
      const dy = oldR.top - newR.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      animated.push(el);
    }
    if (animated.length === 0) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const el of animated) {
          el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.32, 0.72, 0.4, 1)`;
          el.style.transform = '';
        }
        setTimeout(() => {
          for (const el of animated) {
            el.style.transition = '';
            el.style.transform = '';
          }
        }, FLIP_MS + 40);
      });
    });
  }

  _finalize(played) {
    this.cloneWrap?.remove();
    this.indicator?.remove();
    this.trashZone?.remove();

    const dragged = this.draggedEl;
    if (dragged) {
      dragged.classList.remove('is-source', 'is-incoming', 'is-pressed', 'is-charging', 'is-filled');
      if (played) {
        dragged.classList.add('is-settling');
        setTimeout(() => dragged.classList.remove('is-settling'), SETTLE_MS + 30);
      }
    }

    document.body.classList.remove('drag-context');

    this.cloneWrap = null;
    this.cloneInner = null;
    this.indicator = null;
    this.trashZone = null;
    this._trashText = null;
    this.target = null;
    this.dropMode = 'reorder';
    this.draggedEl = null;
    this.state = null;
    this.updatePending = false;
  }

  _cancelPress() {
    if (!this.state) return;
    clearTimeout(this.state.chargeStartTimer);
    clearTimeout(this.state.longPressTimer);
    const c = this.state.container;
    c.classList.remove('is-pressed', 'is-filled');
    if (c.classList.contains('is-charging')) {
      c.classList.add('is-relaxing');
      setTimeout(() => c.classList.remove('is-charging', 'is-relaxing'), 180);
    } else {
      c.classList.remove('is-charging');
    }

    document.removeEventListener('pointermove', this._onMove);
    document.removeEventListener('pointerup', this._onUp);
    document.removeEventListener('pointercancel', this._onUp);
    this.state = null;
  }
}
