import { CONSTANTS } from './utils.js';

export class DragSort {
  constructor({ photoWall, onReorder }) {
    this.photoWall = photoWall;
    this.onReorder = onReorder;

    this.state = null;
    this.clone = null;
    this.placeholder = null;
    this.draggedEl = null;
    this.placeholderUpdatePending = false;

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
      if (this.isDragging) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  _onPointerDown(e, container) {
    if (this.isDragging || this.state) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();

    this.state = {
      container,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      longPressTimer: setTimeout(() => this._beginDrag(), CONSTANTS.LONG_PRESS_MS),
    };
    container.classList.add('long-pressing');

    container.setPointerCapture?.(e.pointerId);
    document.addEventListener('pointermove', this._onMove);
    document.addEventListener('pointerup', this._onUp);
    document.addEventListener('pointercancel', this._onUp);
  }

  _onMove(e) {
    if (!this.state || e.pointerId !== this.state.pointerId) return;

    if (!this.isDragging) {
      const dx = Math.abs(e.clientX - this.state.startX);
      const dy = Math.abs(e.clientY - this.state.startY);
      if (dx > CONSTANTS.DRAG_CANCEL_DISTANCE || dy > CONSTANTS.DRAG_CANCEL_DISTANCE) {
        this._cancel();
      }
      return;
    }

    e.preventDefault();
    this._moveClone(e.clientX, e.clientY);
    if (!this.placeholderUpdatePending) {
      this.placeholderUpdatePending = true;
      requestAnimationFrame(() => {
        this._updatePlaceholder(e.clientX, e.clientY);
        this.placeholderUpdatePending = false;
      });
    }
  }

  _onUp(e) {
    if (!this.state || e.pointerId !== this.state.pointerId) return;

    if (this.isDragging) {
      this._commitReorder();
    }
    this._cancel();
  }

  _beginDrag() {
    if (!this.state) return;
    const { container } = this.state;
    const rect = container.getBoundingClientRect();

    navigator.vibrate?.(50);

    const clone = container.cloneNode(true);
    clone.className = 'drag-clone';
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    document.body.appendChild(clone);
    this.clone = clone;

    const placeholder = document.createElement('div');
    placeholder.className = 'photo-container ios-placeholder';
    placeholder.style.height = `${container.offsetHeight}px`;
    container.parentNode.insertBefore(placeholder, container.nextSibling);
    this.placeholder = placeholder;

    container.classList.remove('long-pressing');
    container.classList.add('ios-dragging');
    this.draggedEl = container;

    document.body.classList.add('ios-drag-mode');
    this._moveClone(this.state.startX, this.state.startY);
  }

  _moveClone(x, y) {
    if (!this.clone) return;
    const w = this.clone.offsetWidth / 2;
    const h = this.clone.offsetHeight / 2;
    this.clone.style.transform = `translate(${x - w}px, ${y - h}px)`;
  }

  _updatePlaceholder(x, y) {
    if (!this.placeholder || !this.draggedEl) return;
    const candidates = [...this.photoWall.querySelectorAll('.photo-container')].filter(
      (el) => el !== this.draggedEl && el !== this.placeholder
    );
    if (candidates.length === 0) return;

    let best = null;
    let bestDist = Infinity;
    let insertAfter = false;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestDist) {
        bestDist = d;
        best = el;
        insertAfter = x > cx;
      }
    }

    if (!best) return;
    const target = insertAfter ? best.nextSibling : best;
    if (this.placeholder !== target && this.placeholder.nextSibling !== target) {
      best.parentNode.insertBefore(this.placeholder, target);
    }
  }

  _commitReorder() {
    if (this.placeholder && this.draggedEl) {
      this.placeholder.parentNode.insertBefore(this.draggedEl, this.placeholder);
      this.onReorder?.();
    }
  }

  _cancel() {
    if (this.state?.longPressTimer) clearTimeout(this.state.longPressTimer);
    if (this.state?.container) this.state.container.classList.remove('long-pressing');

    this.clone?.remove();
    this.placeholder?.remove();
    if (this.draggedEl) {
      this.draggedEl.classList.remove('ios-dragging');
    }
    document.body.classList.remove('ios-drag-mode');

    document.removeEventListener('pointermove', this._onMove);
    document.removeEventListener('pointerup', this._onUp);
    document.removeEventListener('pointercancel', this._onUp);

    this.clone = null;
    this.placeholder = null;
    this.draggedEl = null;
    this.state = null;
    this.placeholderUpdatePending = false;
  }
}
