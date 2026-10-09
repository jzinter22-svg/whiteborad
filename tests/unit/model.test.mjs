import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLesson, normalizeLesson, History, strokeHitsCircle, zoomAt, screenToWorld,
  DEFAULT_FONT_SIZE, FONT_SIZES, createTextObject, newId,
} from '../../js/model.js';

const stroke = (id, pts, width = 3) => ({ id, color: '#000', width, pts });

test('الدرس الجديد يبدأ بحجم 16px دائمًا', () => {
  assert.equal(DEFAULT_FONT_SIZE, 16);
  assert.equal(createLesson().fontSize, 16);
  assert.deepEqual(FONT_SIZES, [14, 16, 18, 20, 24, 28]);
});

test('normalizeLesson يحفظ حجم الخط الصالح ويرفض غير الصالح', () => {
  assert.equal(normalizeLesson({ ...createLesson(), fontSize: 24 }).fontSize, 24);
  assert.equal(normalizeLesson({ ...createLesson(), fontSize: 99 }).fontSize, 16);
  assert.equal(normalizeLesson({ id: 'x' }).fontSize, 16);
  assert.throws(() => normalizeLesson(null));
});

test('normalizeLesson لا يحذف المحتوى الصالح ويتجاهل التالف فقط', () => {
  const l = createLesson();
  l.strokes.push(stroke('a', [0, 0, 0.5, 5, 5, 0.5]));
  l.objects.push(createTextObject({ x: 1, y: 2, text: 'مرحبا', fontSize: 20 }));
  const raw = JSON.parse(JSON.stringify(l));
  raw.strokes.push({ id: 'bad', pts: [1, 2] }); // طول غير صالح
  const n = normalizeLesson(raw);
  assert.equal(n.strokes.length, 1);
  assert.equal(n.objects[0].text, 'مرحبا');
  assert.equal(n.objects[0].fontSize, 20);
  assert.equal(n.objects[0].dir, 'rtl');
});

test('التراجع والإعادة للخطوط', () => {
  const l = createLesson(), h = new History();
  h.push(l, { type: 'addStroke', stroke: stroke('a', [0, 0, 0.5]) });
  h.push(l, { type: 'addStroke', stroke: stroke('b', [1, 1, 0.5]) });
  assert.equal(l.strokes.length, 2);
  assert.ok(h.undo(l)); assert.deepEqual(l.strokes.map((s) => s.id), ['a']);
  assert.ok(h.canRedo);
  assert.ok(h.redo(l)); assert.deepEqual(l.strokes.map((s) => s.id), ['a', 'b']);
  h.undo(l);
  h.push(l, { type: 'addStroke', stroke: stroke('c', [2, 2, 0.5]) });
  assert.equal(h.canRedo, false, 'إجراء جديد يمسح الإعادة');
});

test('التراجع عن المحو يعيد الخطوط إلى مواضعها الأصلية', () => {
  const l = createLesson(), h = new History();
  ['a', 'b', 'c', 'd'].forEach((id, i) => h.push(l, { type: 'addStroke', stroke: stroke(id, [i, i, 0.5]) }));
  const items = [1, 3].map((index) => ({ stroke: l.strokes[index], index }));
  h.push(l, { type: 'removeStrokes', items });
  assert.deepEqual(l.strokes.map((s) => s.id), ['a', 'c']);
  h.undo(l);
  assert.deepEqual(l.strokes.map((s) => s.id), ['a', 'b', 'c', 'd']);
});

test('مسح السبورة قابل للتراجع ويعيد الخطوط والنصوص', () => {
  const l = createLesson(), h = new History();
  h.push(l, { type: 'addStroke', stroke: stroke('a', [0, 0, 0.5]) });
  h.push(l, { type: 'addObject', object: createTextObject({ x: 0, y: 0, text: 'س' }) });
  h.push(l, { type: 'clear', strokes: l.strokes.slice(), objects: l.objects.slice() });
  assert.equal(l.strokes.length + l.objects.length, 0);
  h.undo(l);
  assert.equal(l.strokes.length, 1);
  assert.equal(l.objects.length, 1);
});

test('تعديل/حذف كائن نصي قابل للتراجع', () => {
  const l = createLesson(), h = new History();
  const o = createTextObject({ x: 0, y: 0, text: 'قبل' });
  h.push(l, { type: 'addObject', object: o });
  h.push(l, { type: 'updateObject', id: o.id, before: { text: 'قبل', fontSize: 16 }, after: { text: 'بعد', fontSize: 24 } });
  assert.equal(l.objects[0].text, 'بعد'); assert.equal(l.objects[0].fontSize, 24);
  h.undo(l);
  assert.equal(l.objects[0].text, 'قبل'); assert.equal(l.objects[0].fontSize, 16);
  h.push(l, { type: 'removeObject', object: o, index: 0 });
  assert.equal(l.objects.length, 0);
  h.undo(l);
  assert.equal(l.objects[0].id, o.id);
});

test('حد سجل التراجع', () => {
  const l = createLesson(), h = new History(5);
  for (let i = 0; i < 9; i++) h.push(l, { type: 'addStroke', stroke: stroke(`s${i}`, [i, i, 0.5]) });
  assert.equal(h.undoStack.length, 5);
});

test('strokeHitsCircle: خط وحيد النقطة وخط متعدد المقاطع', () => {
  assert.ok(strokeHitsCircle(stroke('d', [10, 10, 0.5]), 12, 10, 3));
  assert.ok(!strokeHitsCircle(stroke('d', [10, 10, 0.5]), 30, 10, 3));
  const line = stroke('l', [0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5]);
  assert.ok(strokeHitsCircle(line, 50, 4, 5), 'قرب منتصف المقطع الأول');
  assert.ok(!strokeHitsCircle(line, 50, 50, 5), 'داخل الزاوية بعيد عن الخط');
  assert.ok(strokeHitsCircle(line, 104, 60, 3), 'قرب المقطع الثاني');
});

test('zoomAt يثبّت النقطة تحت الإصبع', () => {
  const v = { x: 40, y: -20, scale: 1 };
  const before = screenToWorld(v, 300, 200);
  const z = zoomAt(v, 300, 200, 2);
  const after = screenToWorld(z, 300, 200);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(zoomAt(v, 0, 0, 100).scale, 4, 'حد أقصى للتكبير');
  assert.equal(zoomAt(v, 0, 0, 0.001).scale, 0.25, 'حد أدنى');
});

test('newId فريد', () => {
  const s = new Set(Array.from({ length: 2000 }, () => newId('x')));
  assert.equal(s.size, 2000);
});
