// نموذج الدرس: بيانات نقية بلا اعتماد على DOM (قابلة للاختبار في Node).

export const SCHEMA_VERSION = 1;
export const DEFAULT_FONT_SIZE = 16; // px — الحجم الافتراضي المطلوب للنص المطبوع
export const FONT_SIZES = [14, 16, 18, 20, 24, 28];
export const PEN_COLORS = ['#111827', '#1d4ed8', '#dc2626', '#15803d', '#d97706', '#7e22ce'];

let counter = 0;
export function newId(prefix = 'id') {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createLesson({ title = 'درس جديد', now = Date.now() } = {}) {
  return {
    schema: SCHEMA_VERSION,
    id: newId('lesson'),
    title,
    createdAt: now,
    updatedAt: now,
    // كل درس جديد يبدأ بـ 16px دائمًا (وليس بآخر قيمة اختارها المستخدم)
    fontSize: DEFAULT_FONT_SIZE,
    view: { x: 0, y: 0, scale: 1 },
    strokes: [], // {id,color,width,pts:[x,y,p,...]}
    objects: [], // {id,type:'text',x,y,w,text,fontSize,dir}
  };
}

const num = (v, d) => (Number.isFinite(v) ? v : d);

// يتحقق من درس محمّل من التخزين ويصلحه دون حذف محتوى صالح.
export function normalizeLesson(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('درس غير صالح');
  const base = createLesson();
  const lesson = {
    ...base,
    id: typeof raw.id === 'string' ? raw.id : base.id,
    title: typeof raw.title === 'string' ? raw.title : base.title,
    createdAt: num(raw.createdAt, base.createdAt),
    updatedAt: num(raw.updatedAt, base.updatedAt),
    fontSize: FONT_SIZES.includes(raw.fontSize) ? raw.fontSize : DEFAULT_FONT_SIZE,
    view: {
      x: num(raw.view?.x, 0),
      y: num(raw.view?.y, 0),
      scale: Math.min(4, Math.max(0.25, num(raw.view?.scale, 1))),
    },
    strokes: [],
    objects: [],
  };
  for (const s of Array.isArray(raw.strokes) ? raw.strokes : []) {
    if (s && Array.isArray(s.pts) && s.pts.length >= 3 && s.pts.length % 3 === 0) {
      lesson.strokes.push({
        id: typeof s.id === 'string' ? s.id : newId('s'),
        color: typeof s.color === 'string' ? s.color : PEN_COLORS[0],
        width: num(s.width, 3),
        pts: s.pts.map((n) => num(n, 0)),
      });
    }
  }
  for (const o of Array.isArray(raw.objects) ? raw.objects : []) {
    if (o && o.type === 'text') {
      lesson.objects.push({
        id: typeof o.id === 'string' ? o.id : newId('o'),
        type: 'text',
        x: num(o.x, 0),
        y: num(o.y, 0),
        w: num(o.w, 260),
        text: typeof o.text === 'string' ? o.text : '',
        fontSize: num(o.fontSize, lesson.fontSize),
        dir: o.dir === 'ltr' ? 'ltr' : 'rtl',
      });
    }
  }
  return lesson;
}

export function createTextObject({ x, y, text = '', fontSize = DEFAULT_FONT_SIZE, w = 260 }) {
  return { id: newId('o'), type: 'text', x, y, w, text, fontSize, dir: 'rtl' };
}

// ---------- الهندسة ----------

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// هل يقطع الممحاة (دائرة نصف قطرها r) الخط؟
export function strokeHitsCircle(stroke, cx, cy, r) {
  const p = stroke.pts;
  const reach = r + stroke.width / 2;
  if (p.length === 3) return Math.hypot(cx - p[0], cy - p[1]) <= reach;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (distToSegment(cx, cy, p[i], p[i + 1], p[i + 3], p[i + 4]) <= reach) return true;
  }
  return false;
}

export function strokeBounds(stroke) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < stroke.pts.length; i += 3) {
    x0 = Math.min(x0, stroke.pts[i]); x1 = Math.max(x1, stroke.pts[i]);
    y0 = Math.min(y0, stroke.pts[i + 1]); y1 = Math.max(y1, stroke.pts[i + 1]);
  }
  const pad = stroke.width;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

// ---------- سجل التراجع/الإعادة (أوامر قابلة للعكس) ----------

export function applyAction(lesson, a) {
  switch (a.type) {
    case 'addStroke': lesson.strokes.push(a.stroke); break;
    case 'removeStrokes': {
      const ids = new Set(a.items.map((i) => i.stroke.id));
      lesson.strokes = lesson.strokes.filter((s) => !ids.has(s.id));
      break;
    }
    case 'clear': lesson.strokes = []; lesson.objects = []; break;
    case 'addObject': lesson.objects.push(a.object); break;
    case 'removeObject': lesson.objects = lesson.objects.filter((o) => o.id !== a.object.id); break;
    case 'updateObject': {
      const o = lesson.objects.find((x) => x.id === a.id);
      if (o) Object.assign(o, a.after);
      break;
    }
    case 'setFontSize': lesson.fontSize = a.after; break;
    default: throw new Error(`إجراء غير معروف: ${a.type}`);
  }
}

export function revertAction(lesson, a) {
  switch (a.type) {
    case 'addStroke': lesson.strokes = lesson.strokes.filter((s) => s.id !== a.stroke.id); break;
    case 'removeStrokes': {
      // نعيد إدراج الخطوط في مواضعها الأصلية (بترتيب الفهارس التصاعدي)
      for (const { stroke, index } of [...a.items].sort((p, q) => p.index - q.index)) {
        lesson.strokes.splice(Math.min(index, lesson.strokes.length), 0, stroke);
      }
      break;
    }
    case 'clear': lesson.strokes = a.strokes.slice(); lesson.objects = a.objects.slice(); break;
    case 'addObject': lesson.objects = lesson.objects.filter((o) => o.id !== a.object.id); break;
    case 'removeObject': lesson.objects.splice(Math.min(a.index, lesson.objects.length), 0, a.object); break;
    case 'updateObject': {
      const o = lesson.objects.find((x) => x.id === a.id);
      if (o) Object.assign(o, a.before);
      break;
    }
    case 'setFontSize': lesson.fontSize = a.before; break;
    default: throw new Error(`إجراء غير معروف: ${a.type}`);
  }
}

export class History {
  constructor(limit = 300) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  reset() { this.undoStack = []; this.redoStack = []; }
  push(lesson, action) {
    applyAction(lesson, action);
    this.undoStack.push(action);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(lesson) {
    const a = this.undoStack.pop();
    if (!a) return false;
    revertAction(lesson, a);
    this.redoStack.push(a);
    return true;
  }
  redo(lesson) {
    const a = this.redoStack.pop();
    if (!a) return false;
    applyAction(lesson, a);
    this.undoStack.push(a);
    return true;
  }
}

// ---------- العرض (تحويلات) ----------

export function clampScale(s) { return Math.min(4, Math.max(0.25, s)); }

// تكبير حول نقطة شاشة (sx,sy) مع ثبات النقطة العالمية تحتها.
export function zoomAt(view, sx, sy, newScale) {
  const scale = clampScale(newScale);
  const wx = (sx - view.x) / view.scale;
  const wy = (sy - view.y) / view.scale;
  return { scale, x: sx - wx * scale, y: sy - wy * scale };
}

export function screenToWorld(view, sx, sy) {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}
