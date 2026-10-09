import test from 'node:test';
import assert from 'node:assert/strict';
import { Autosaver } from '../../js/store.js';

function fakeTimers() {
  let id = 0; const q = new Map();
  return {
    set: (fn) => { q.set(++id, fn); return id; },
    clear: (i) => q.delete(i),
    fire: () => { const fns = [...q.values()]; q.clear(); fns.forEach((f) => f()); },
    get pending() { return q.size; },
  };
}

test('Autosaver: يؤجل الحفظ ثم يحفظ لقطة مستقلة ويبلّغ الحالة', async () => {
  const timers = fakeTimers(); const saved = []; const states = [];
  const lesson = { id: 'l1', strokes: [], updatedAt: 0 };
  const store = { put: async (l) => { saved.push(l); } };
  const a = new Autosaver({ store, getLesson: () => lesson, onStatus: (s) => states.push(s), timers });
  a.markDirty(); a.markDirty();
  assert.equal(timers.pending, 1, 'تجميع عدة تعديلات في مؤقت واحد');
  lesson.strokes.push('x');
  timers.fire();
  await a._inflight;
  assert.equal(saved.length, 1);
  assert.notEqual(saved[0], lesson, 'لقطة منفصلة عن الكائن الحي');
  lesson.strokes.push('y');
  assert.deepEqual(saved[0].strokes, ['x']);
  assert.deepEqual(states, ['dirty', 'dirty', 'saving', 'saved']);
});

test('Autosaver: يبلّغ عن الخطأ ولا يدّعي النجاح', async () => {
  const timers = fakeTimers(); const states = [];
  const store = { put: async () => { throw new Error('quota'); } };
  const origErr = console.error; console.error = () => {};
  const a = new Autosaver({ store, getLesson: () => ({ id: 'x' }), onStatus: (s) => states.push(s), timers });
  a.markDirty(); await a.flush();
  console.error = origErr;
  assert.equal(states.at(-1), 'error');
});

test('Autosaver: flush يحفظ فورًا ويلغي المؤقت', async () => {
  const timers = fakeTimers(); let n = 0;
  const a = new Autosaver({ store: { put: async () => { n++; } }, getLesson: () => ({ id: 'x' }), timers });
  a.markDirty(); await a.flush();
  assert.equal(n, 1); assert.equal(timers.pending, 0);
});

test('Autosaver: المؤقتات الافتراضية (الحقيقية) تعمل فعلًا', async () => {
  let saved = 0;
  const a = new Autosaver({ store: { put: async () => { saved++; } }, getLesson: () => ({ id: 'x' }), delay: 10 });
  a.markDirty();
  await new Promise((r) => setTimeout(r, 80));
  await a._inflight;
  assert.equal(saved, 1);
  assert.equal(a.status, 'saved');
});
