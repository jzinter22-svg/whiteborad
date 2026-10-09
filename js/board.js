// محرّك السبورة: رسم، إدخال القلم/اللمس، تكبير/تحريك، كائنات النص.
import {
  History, newId, strokeBounds, strokeHitsCircle, screenToWorld, zoomAt, clampScale,
} from './model.js';

const ERASER_RADIUS_PX = 14;
const MIN_POINT_DIST = 0.6; // بالبكسل العالمي — يقلل النقاط المتكررة

// ---- رسم الخطوط (نفس الخوارزمية للمعاينة الحية والرسم النهائي) ----
function mid(a, b) { return (a + b) / 2; }
function widthAt(base, p) { return base * Math.min(1.6, Math.max(0.5, 0.5 + p)); }

// المقطع i (1..n-1): من M(i-1) إلى M(i) بنقطة تحكم p[i]
function segment(pts, i, n) {
  const px = (k) => pts[k * 3], py = (k) => pts[k * 3 + 1];
  const M = (k) => (k === 0 || k === n - 1 ? [px(k), py(k)] : [mid(px(k), px(k + 1)), mid(py(k), py(k + 1))]);
  const [sx, sy] = i === 1 ? [px(0), py(0)] : M(i - 1);
  const [ex, ey] = M(i);
  return { sx, sy, cx: px(i), cy: py(i), ex, ey, p: pts[i * 3 + 2] };
}

function drawSeg(ctx, s, color, width) {
  ctx.beginPath();
  ctx.moveTo(s.sx, s.sy);
  ctx.quadraticCurveTo(s.cx, s.cy, s.ex, s.ey);
  ctx.lineWidth = widthAt(width, s.p);
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawDot(ctx, pts, color, width) {
  ctx.beginPath();
  ctx.arc(pts[0], pts[1], widthAt(width, pts[2]) / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// يرسم المقاطع من from إلى to (شاملة) للخط ذي n نقطة
function drawRange(ctx, pts, from, to, color, width) {
  const n = pts.length / 3;
  for (let i = Math.max(1, from); i <= to && i <= n - 1; i++) drawSeg(ctx, segment(pts, i, n), color, width);
}

export function drawStroke(ctx, stroke) {
  const n = stroke.pts.length / 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1) drawDot(ctx, stroke.pts, stroke.color, stroke.width);
  else drawRange(ctx, stroke.pts, 1, n - 1, stroke.color, stroke.width);
}

export class Board {
  constructor({ stage, baseCanvas, liveCanvas, objectsLayer, hooks = {} }) {
    this.stage = stage;
    this.base = baseCanvas;
    this.live = liveCanvas;
    this.layer = objectsLayer;
    this.hooks = hooks; // onChange, onHistory, onView, onEditText
    this.bctx = baseCanvas.getContext('2d');
    this.lctx = liveCanvas.getContext('2d');
    this.history = new History();
    this.lesson = null;
    this.tool = 'pen'; // pen | eraser | text | pan
    this.color = '#111827';
    this.width = 3;
    this.grid = false;
    this.dpr = 1;
    this.pointers = new Map();
    this.penSeen = false;
    this.gesture = null; // {dist, cx, cy}
    this.cur = null; // الخط الجاري {pointerId, stroke, drawn}
    this.erasing = null; // {pointerId, hidden:Set}
    this.panning = null;
    this.elements = new Map();
    this.selectedId = null;
    this._raf = 0;
    this._bindEvents();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(stage);
  }

  // ---------- الدرس والعرض ----------
  setLesson(lesson) {
    this.lesson = lesson;
    this.history.reset();
    this.cur = this.erasing = this.panning = null;
    this.selectedId = null;
    this.syncObjects();
    this.renderBase();
    this._emitHistory();
    this.hooks.onView?.(this.lesson.view);
  }

  get view() { return this.lesson.view; }

  resize() {
    const r = this.stage.getBoundingClientRect();
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    for (const c of [this.base, this.live]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    if (this.lesson) this.renderBase();
  }

  _applyTransform(ctx) {
    const v = this.view, k = this.dpr;
    ctx.setTransform(k * v.scale, 0, 0, k * v.scale, k * v.x, k * v.y);
  }

  renderBase(hidden = null) {
    if (!this.lesson) return;
    const ctx = this.bctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    this._applyTransform(ctx);
    const v = this.view;
    const vw = this.base.width / this.dpr, vh = this.base.height / this.dpr;
    const wx0 = -v.x / v.scale, wy0 = -v.y / v.scale;
    const wx1 = wx0 + vw / v.scale, wy1 = wy0 + vh / v.scale;
    if (this.grid) this._drawGrid(ctx, wx0, wy0, wx1, wy1);
    for (const s of this.lesson.strokes) {
      if (hidden && hidden.has(s.id)) continue;
      const b = strokeBounds(s);
      if (b.x1 < wx0 || b.x0 > wx1 || b.y1 < wy0 || b.y0 > wy1) continue;
      drawStroke(ctx, s);
    }
    // طبقة النصوص
    this.layer.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  }

  _drawGrid(ctx, x0, y0, x1, y1) {
    const step = 40;
    ctx.fillStyle = '#d6dae1';
    const r = 1.2 / this.view.scale;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }

  setGrid(on) { this.grid = on; this.renderBase(); }

  _viewChanged() {
    this.renderBase();
    this.hooks.onView?.(this.view);
    this.hooks.onChange?.('view');
  }

  zoomBy(factor) {
    const r = this.stage.getBoundingClientRect();
    Object.assign(this.view, zoomAt(this.view, r.width / 2, r.height / 2, this.view.scale * factor));
    this._viewChanged();
  }
  resetView() { Object.assign(this.view, { x: 0, y: 0, scale: 1 }); this._viewChanged(); }

  // ---------- الأدوات ----------
  setTool(t) {
    this.tool = t;
    this.stage.dataset.tool = t;
    this.layer.classList.toggle('editing', t === 'text');
    if (t !== 'text') this.select(null);
    this.lctx.setTransform(1, 0, 0, 1, 0, 0);
    this.lctx.clearRect(0, 0, this.live.width, this.live.height);
  }

  // ---------- أحداث المؤشر ----------
  _bindEvents() {
    const s = this.stage;
    s.addEventListener('pointerdown', (e) => this._down(e));
    s.addEventListener('pointermove', (e) => this._move(e));
    s.addEventListener('pointerup', (e) => this._up(e));
    s.addEventListener('pointercancel', (e) => this._up(e, true));
    s.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _pos(e) {
    const r = this.stage.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  _isTextTarget(e) { return e.target.closest?.('.text-obj'); }

  _down(e) {
    if (!this.lesson) return;
    if (e.pointerType === 'pen') this.penSeen = true;
    if (this._isTextTarget(e) && this.tool === 'text') return; // يعالجها عنصر النص
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    this.stage.setPointerCapture?.(e.pointerId);
    const { sx, sy } = this._pos(e);
    this.pointers.set(e.pointerId, { sx, sy, type: e.pointerType });

    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (touches.length >= 2) { this._startGesture(); return; }

    // اللمس بإصبع واحد: يحرّك السبورة إذا اكتُشف قلم (رفض الكف) أو الأداة "تحريك"
    const touchPans = e.pointerType === 'touch' && this.penSeen && this.tool !== 'text';
    if (this.tool === 'pan' || e.button === 1 || touchPans) {
      this.panning = { id: e.pointerId, lastX: sx, lastY: sy };
      return;
    }
    if (this.tool === 'pen') this._startStroke(e, sx, sy);
    else if (this.tool === 'eraser') this._startErase(e, sx, sy);
    else if (this.tool === 'text') this._tapText(sx, sy);
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const { sx, sy } = this._pos(e);
    p.sx = sx; p.sy = sy;
    if (this.gesture) { this._updateGesture(); return; }
    if (this.panning && this.panning.id === e.pointerId) {
      this.view.x += sx - this.panning.lastX;
      this.view.y += sy - this.panning.lastY;
      this.panning.lastX = sx; this.panning.lastY = sy;
      this._schedulePanRender();
      return;
    }
    if (this.cur && this.cur.pointerId === e.pointerId) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) this._addPoint(ev);
    } else if (this.erasing && this.erasing.pointerId === e.pointerId) {
      this._eraseAt(sx, sy);
    }
  }

  _up(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.stage.releasePointerCapture?.(e.pointerId);
    if (this.gesture) {
      if ([...this.pointers.values()].filter((q) => q.type === 'touch').length < 2) {
        this.gesture = null;
        this.hooks.onChange?.('view');
        // بعد انتهاء التكبير لا نبدأ رسمًا بالإصبع المتبقي
        for (const id of this.pointers.keys()) this.pointers.delete(id);
      }
      return;
    }
    if (this.panning && this.panning.id === e.pointerId) {
      this.panning = null;
      this.hooks.onChange?.('view');
      this.hooks.onView?.(this.view);
      return;
    }
    if (this.cur && this.cur.pointerId === e.pointerId) this._endStroke(cancelled);
    else if (this.erasing && this.erasing.pointerId === e.pointerId) this._endErase();
  }

  _wheel(e) {
    if (!this.lesson) return;
    e.preventDefault();
    const { sx, sy } = this._pos(e);
    if (e.ctrlKey || e.metaKey) {
      Object.assign(this.view, zoomAt(this.view, sx, sy, this.view.scale * Math.exp(-e.deltaY * 0.01)));
    } else {
      this.view.x -= e.shiftKey ? e.deltaY : e.deltaX;
      this.view.y -= e.shiftKey ? 0 : e.deltaY;
    }
    this._viewChanged();
  }

  _schedulePanRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderBase(); });
  }

  // ---------- تكبير/تحريك بإصبعين ----------
  _startGesture() {
    // نلغي أي خط بدأه أحد الإصبعين دون حفظه
    if (this.cur) this._endStroke(true);
    if (this.erasing) this._endErase(true);
    this.panning = null;
    this.gesture = this._gestureState();
  }
  _gestureState() {
    const t = [...this.pointers.values()].filter((p) => p.type === 'touch').slice(0, 2);
    return {
      dist: Math.hypot(t[0].sx - t[1].sx, t[0].sy - t[1].sy) || 1,
      cx: (t[0].sx + t[1].sx) / 2,
      cy: (t[0].sy + t[1].sy) / 2,
    };
  }
  _updateGesture() {
    const g = this.gesture, n = this._gestureState();
    const v = this.view;
    const z = zoomAt(v, g.cx, g.cy, v.scale * (n.dist / g.dist));
    Object.assign(v, z);
    v.x += n.cx - g.cx;
    v.y += n.cy - g.cy;
    this.gesture = n;
    this._schedulePanRender();
    this.hooks.onView?.(v);
  }

  // ---------- القلم ----------
  _startStroke(e, sx, sy) {
    const w = screenToWorld(this.view, sx, sy);
    const pr = this._pressure(e);
    this.cur = {
      pointerId: e.pointerId,
      stroke: { id: newId('s'), color: this.color, width: this.width, pts: [w.x, w.y, pr] },
      drawn: 0, // عدد المقاطع المرسومة
    };
    const ctx = this.lctx;
    this._applyTransform(ctx);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }

  _pressure(e) {
    // الفأرة/اللمس بلا ضغط حقيقي => 0.5 (عرض ثابت)
    if (e.pointerType === 'pen' && e.pressure > 0) return Math.round(e.pressure * 100) / 100;
    return 0.5;
  }

  _addPoint(e) {
    const c = this.cur;
    const r = this.stage.getBoundingClientRect();
    const w = screenToWorld(this.view, e.clientX - r.left, e.clientY - r.top);
    const pts = c.stroke.pts;
    const lx = pts[pts.length - 3], ly = pts[pts.length - 2];
    if (Math.hypot(w.x - lx, w.y - ly) * this.view.scale < MIN_POINT_DIST) return;
    pts.push(Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10, this._pressure(e));
    const n = pts.length / 3;
    // يمكن رسم المقاطع حتى n-2 فقط الآن (تحتاج M(i) نقطة لاحقة)
    this._applyTransform(this.lctx);
    drawRange(this.lctx, pts, c.drawn + 1, n - 2, c.stroke.color, c.stroke.width);
    c.drawn = Math.max(c.drawn, n - 2);
  }

  _endStroke(cancelled) {
    const c = this.cur;
    this.cur = null;
    this.lctx.setTransform(1, 0, 0, 1, 0, 0);
    this.lctx.clearRect(0, 0, this.live.width, this.live.height);
    if (cancelled || !c) return;
    const stroke = c.stroke;
    this.history.push(this.lesson, { type: 'addStroke', stroke });
    this._applyTransform(this.bctx);
    drawStroke(this.bctx, stroke);
    this._emitHistory();
    this.hooks.onChange?.('stroke');
  }

  // ---------- الممحاة (حذف الخط كاملًا، قابل للتراجع) ----------
  _startErase(e, sx, sy) {
    this.erasing = { pointerId: e.pointerId, hidden: new Set() };
    this._eraseAt(sx, sy);
  }
  _eraseAt(sx, sy) {
    const er = this.erasing;
    const r = ERASER_RADIUS_PX / this.view.scale;
    // نفحص المسار بين الموضع السابق والحالي كي لا تفلت الخطوط عند الحركة السريعة
    const from = er.last || { sx, sy };
    const dist = Math.hypot(sx - from.sx, sy - from.sy);
    const steps = Math.max(1, Math.ceil(dist / (ERASER_RADIUS_PX / 2)));
    let hit = false;
    for (let k = 1; k <= steps; k++) {
      const w = screenToWorld(this.view, from.sx + ((sx - from.sx) * k) / steps, from.sy + ((sy - from.sy) * k) / steps);
      for (const s of this.lesson.strokes) {
        if (er.hidden.has(s.id)) continue;
        if (strokeHitsCircle(s, w.x, w.y, r)) { er.hidden.add(s.id); hit = true; }
      }
    }
    er.last = { sx, sy };
    if (hit) this.renderBase(er.hidden);
    // حلقة الممحاة
    const ctx = this.lctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    ctx.beginPath();
    ctx.arc(sx * this.dpr, sy * this.dpr, ERASER_RADIUS_PX * this.dpr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(80,90,110,.6)';
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.stroke();
  }
  _endErase(cancelled = false) {
    const er = this.erasing;
    this.erasing = null;
    this.lctx.setTransform(1, 0, 0, 1, 0, 0);
    this.lctx.clearRect(0, 0, this.live.width, this.live.height);
    if (!er) return;
    if (cancelled || er.hidden.size === 0) { this.renderBase(); return; }
    const items = [];
    this.lesson.strokes.forEach((stroke, index) => { if (er.hidden.has(stroke.id)) items.push({ stroke, index }); });
    this.history.push(this.lesson, { type: 'removeStrokes', items });
    this.renderBase();
    this._emitHistory();
    this.hooks.onChange?.('erase');
  }

  // ---------- التراجع/الإعادة/المسح ----------
  undo() { if (this.cur || this.erasing) return; if (this.history.undo(this.lesson)) this._afterHistory(); }
  redo() { if (this.cur || this.erasing) return; if (this.history.redo(this.lesson)) this._afterHistory(); }
  _afterHistory() {
    this.syncObjects();
    this.renderBase();
    this._emitHistory();
    this.hooks.onChange?.('history');
  }
  clearAll() {
    const l = this.lesson;
    if (!l.strokes.length && !l.objects.length) return;
    this.history.push(l, { type: 'clear', strokes: l.strokes.slice(), objects: l.objects.slice() });
    this.select(null);
    this._afterHistory();
  }
  _emitHistory() { this.hooks.onHistory?.(this.history.canUndo, this.history.canRedo); }

  // أي تعديل خارجي على الدرس (مثل حجم الخط)
  commit(action) {
    this.history.push(this.lesson, action);
    this._afterHistory();
  }

  // ---------- كائنات النص ----------
  syncObjects() {
    const seen = new Set();
    for (const o of this.lesson?.objects ?? []) {
      seen.add(o.id);
      let el = this.elements.get(o.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'text-obj';
        el.dataset.id = o.id;
        this._bindTextEl(el);
        this.layer.appendChild(el);
        this.elements.set(o.id, el);
      }
      this.paintText(el, o);
    }
    for (const [id, el] of this.elements) {
      if (!seen.has(id)) { el.remove(); this.elements.delete(id); }
    }
  }

  paintText(el, o) {
    el.textContent = o.text;
    el.dir = o.dir;
    el.style.left = `${o.x}px`;
    el.style.top = `${o.y}px`;
    el.style.width = `${o.w}px`;
    el.style.fontSize = `${o.fontSize}px`;
    el.classList.toggle('selected', o.id === this.selectedId);
  }

  select(id) {
    this.selectedId = id;
    for (const [oid, el] of this.elements) el.classList.toggle('selected', oid === id);
  }

  _bindTextEl(el) {
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (this.tool !== 'text') return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const o = this.lesson.objects.find((x) => x.id === el.dataset.id);
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, moved: false, o };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = (e.clientX - drag.sx) / this.view.scale, dy = (e.clientY - drag.sy) / this.view.scale;
      if (!drag.moved && Math.hypot(dx, dy) * this.view.scale < 6) return;
      drag.moved = true;
      el.style.left = `${drag.ox + dx}px`;
      el.style.top = `${drag.oy + dy}px`;
      drag.nx = drag.ox + dx; drag.ny = drag.oy + dy;
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag; drag = null;
      if (d.moved) {
        this.commit({ type: 'updateObject', id: d.o.id, before: { x: d.ox, y: d.oy }, after: { x: Math.round(d.nx), y: Math.round(d.ny) } });
      } else {
        this.select(d.o.id);
        this.hooks.onEditText?.(d.o, false);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { drag = null; this.syncObjects(); });
  }

  _tapText(sx, sy) {
    const w = screenToWorld(this.view, sx, sy);
    this.select(null);
    this.hooks.onEditText?.({ x: Math.round(w.x), y: Math.round(w.y) }, true);
  }

  // مركز الرؤية بالإحداثيات العالمية (لوضع نص جديد)
  viewCenter() {
    const r = this.stage.getBoundingClientRect();
    return screenToWorld(this.view, r.width / 2, r.height / 2);
  }
}
