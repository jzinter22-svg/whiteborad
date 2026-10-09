// التخزين المحلي: IndexedDB للدروس + Autosaver (مع إمكانية الحقن للاختبار).

const DB_NAME = 'math-whiteboard';
const DB_VERSION = 1;
const STORE = 'lessons';
export const LAST_KEY = 'mw:lastLessonId';

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IdbLessonStore {
  constructor() { this._db = null; }
  async _open() {
    if (this._db) return this._db;
    this._db = await new Promise((resolve, reject) => {
      const o = indexedDB.open(DB_NAME, DB_VERSION);
      o.onupgradeneeded = () => {
        o.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      o.onsuccess = () => resolve(o.result);
      o.onerror = () => reject(o.error);
    });
    return this._db;
  }
  async _tx(mode, fn) {
    const db = await this._open();
    const tx = db.transaction(STORE, mode);
    const out = await fn(tx.objectStore(STORE));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('تم إلغاء المعاملة'));
    });
    return out;
  }
  put(lesson) { return this._tx('readwrite', (s) => req(s.put(lesson))); }
  get(id) { return this._tx('readonly', (s) => req(s.get(id))); }
  delete(id) { return this._tx('readwrite', (s) => req(s.delete(id))); }
  async list() {
    const all = await this._tx('readonly', (s) => req(s.getAll()));
    return all
      .map((l) => ({ id: l.id, title: l.title, updatedAt: l.updatedAt, strokes: l.strokes?.length ?? 0, objects: l.objects?.length ?? 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

// يؤجل الحفظ (debounce) ويبلغ عن الحالة: saved | dirty | saving | error
export class Autosaver {
  constructor({ store, getLesson, onStatus = () => {}, delay = 700, timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) } }) {
    Object.assign(this, { store, getLesson, onStatus, delay, timers });
    this._t = null;
    this._inflight = Promise.resolve();
    this.status = 'saved';
  }
  _set(s) { this.status = s; this.onStatus(s); }
  markDirty() {
    this._set('dirty');
    if (this._t) this.timers.clear(this._t);
    this._t = this.timers.set(() => { this._t = null; this.flush(); }, this.delay);
  }
  // يحفظ فورًا (يُستدعى عند إخفاء الصفحة أو تبديل الدرس)
  flush() {
    if (this._t) { this.timers.clear(this._t); this._t = null; }
    const lesson = this.getLesson();
    if (!lesson) return this._inflight;
    lesson.updatedAt = Date.now();
    this._set('saving');
    // نأخذ لقطة مستقلة كي لا تتغير البيانات أثناء الكتابة
    const snapshot = JSON.parse(JSON.stringify(lesson));
    this._inflight = this._inflight
      .then(() => this.store.put(snapshot))
      .then(() => { if (!this._t) this._set('saved'); })
      .catch((e) => { console.error('فشل الحفظ', e); this._set('error'); });
    return this._inflight;
  }
}
