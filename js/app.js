// ربط الواجهة: الأدوات، الحفظ التلقائي، الدروس، محرر النص.
import { Board } from './board.js';
import {
  createLesson, normalizeLesson, createTextObject, FONT_SIZES, PEN_COLORS, DEFAULT_FONT_SIZE,
} from './model.js';
import { IdbLessonStore, Autosaver, LAST_KEY } from './store.js';

const $ = (id) => document.getElementById(id);
const store = new IdbLessonStore();
let lesson = null;

const board = new Board({
  stage: $('stage'), baseCanvas: $('base'), liveCanvas: $('live'), objectsLayer: $('objects'),
  hooks: {
    onChange: () => saver.markDirty(),
    onHistory: (u, r) => { $('btn-undo').disabled = !u; $('btn-redo').disabled = !r; },
    onView: (v) => { $('btn-zoom-reset').textContent = `${Math.round(v.scale * 100)}%`; },
    onEditText: (obj, isNew) => openEditor(obj, isNew),
  },
});

const STATUS = { saved: 'محفوظ', dirty: 'تعديلات غير محفوظة', saving: 'جارٍ الحفظ…', error: 'تعذّر الحفظ!' };
const saver = new Autosaver({
  store, getLesson: () => lesson, delay: 700,
  onStatus: (s) => { const el = $('save-status'); el.dataset.state = s; el.textContent = STATUS[s]; },
});

// ---------- الدروس ----------
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* التخزين غير متاح */ } }

async function openLesson(l) {
  closeEditor(false);
  lesson = l;
  lsSet(LAST_KEY, l.id);
  board.setLesson(l);
  board.setGrid(board.grid);
  $('lesson-title').textContent = l.title;
  $('font-size').value = String(l.fontSize);
}

async function newLesson() {
  await saver.flush();
  const l = createLesson();
  await store.put(l);
  await openLesson(l);
}

async function loadInitial() {
  let l = null;
  try {
    const id = lsGet(LAST_KEY);
    if (id) { const raw = await store.get(id); if (raw) l = normalizeLesson(raw); }
    if (!l) {
      const list = await store.list();
      if (list.length) l = normalizeLesson(await store.get(list[0].id));
    }
  } catch (e) { console.error('تعذّر استرجاع الدرس', e); $('save-status').dataset.state = 'error'; $('save-status').textContent = STATUS.error; }
  if (!l) { l = createLesson(); try { await store.put(l); } catch { /* سيظهر خطأ الحفظ لاحقًا */ } }
  await openLesson(l);
}

// ---------- الحوارات ----------
function confirmDialog(msg, yesLabel = 'تأكيد') {
  const d = $('dlg-confirm');
  $('confirm-msg').textContent = msg;
  $('confirm-yes').textContent = yesLabel;
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true });
    d.showModal();
  });
}
function promptDialog(value) {
  const d = $('dlg-prompt'), input = $('prompt-input');
  input.value = value;
  return new Promise((resolve) => {
    d.addEventListener('close', () => resolve(d.returnValue === 'yes' ? input.value.trim() : null), { once: true });
    d.showModal();
    input.select();
  });
}

async function renderLessonList() {
  const ul = $('lesson-list');
  ul.textContent = '';
  const list = await store.list();
  const fmt = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' });
  for (const it of list) {
    const li = document.createElement('li');
    if (it.id === lesson.id) li.className = 'current';
    li.innerHTML = '<div class="info"><b></b><small></small></div>';
    li.querySelector('b').textContent = it.title;
    li.querySelector('small').textContent = `${fmt.format(it.updatedAt)} — ${it.strokes} خط، ${it.objects} نص`;
    const open = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: 'فتح' });
    open.onclick = async () => {
      await saver.flush();
      await openLesson(normalizeLesson(await store.get(it.id)));
      $('dlg-lessons').close();
    };
    const del = Object.assign(document.createElement('button'), { className: 'btn danger', type: 'button', textContent: 'حذف' });
    del.onclick = async () => {
      if (!(await confirmDialog(`حذف الدرس «${it.title}» نهائيًا؟ لا يمكن التراجع.`, 'حذف'))) return;
      await store.delete(it.id);
      if (it.id === lesson.id) await newLessonFromDeleted();
      renderLessonList();
    };
    li.append(open, del);
    ul.append(li);
  }
}
async function newLessonFromDeleted() {
  const l = createLesson();
  await store.put(l);
  await openLesson(l);
}

// ---------- الأدوات ----------
function setTool(t) {
  board.setTool(t);
  document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  if (t !== 'text') closeEditor(true);
}
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

// الألوان
const colorsEl = $('colors');
PEN_COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.style.background = c; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', `لون ${i + 1}`);
  b.setAttribute('aria-checked', String(i === 0)); b.dataset.color = c;
  b.onclick = () => {
    board.color = c; $('width-preview').style.background = c;
    colorsEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    if (board.tool !== 'pen') setTool('pen');
  };
  colorsEl.append(b);
});
function updateWidth() {
  const w = Number($('width').value);
  board.width = w;
  const p = $('width-preview').style; p.width = p.height = `${Math.min(26, Math.max(2, w))}px`; p.background = board.color;
}
$('width').addEventListener('input', updateWidth);
updateWidth();

// حجم الخط الافتراضي (يُحفظ مع الدرس، ولا يغيّر النصوص الموجودة)
for (const sel of [$('font-size'), $('editor-size')]) {
  for (const s of FONT_SIZES) sel.append(new Option(`${s}px`, String(s)));
}
$('font-size').value = String(DEFAULT_FONT_SIZE);
$('font-size').addEventListener('change', () => {
  lesson.fontSize = Number($('font-size').value);
  saver.markDirty();
});

$('btn-undo').onclick = () => board.undo();
$('btn-redo').onclick = () => board.redo();
$('btn-zoom-in').onclick = () => board.zoomBy(1.25);
$('btn-zoom-out').onclick = () => board.zoomBy(0.8);
$('btn-zoom-reset').onclick = () => board.resetView();
$('btn-recog').onclick = () => $('dlg-recog').showModal();
$('btn-lessons').onclick = async () => { await saver.flush(); await renderLessonList(); $('dlg-lessons').showModal(); };
$('lessons-new').onclick = async () => { $('dlg-lessons').close(); await newLesson(); };
async function renameLesson() {
  const t = await promptDialog(lesson.title);
  if (t) { lesson.title = t; $('lesson-title').textContent = t; saver.markDirty(); }
}
$('lesson-title').onclick = renameLesson;

// القائمة
const menu = $('menu');
function toggleMenu(show) {
  menu.hidden = !show;
  $('btn-more').setAttribute('aria-expanded', String(show));
}
$('btn-more').onclick = (e) => { e.stopPropagation(); toggleMenu(menu.hidden); };
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== $('btn-more')) toggleMenu(false); });
menu.addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  toggleMenu(false);
  if (act === 'new') await newLesson();
  if (act === 'rename') await renameLesson();
  if (act === 'clear') {
    if (await confirmDialog('سيتم مسح كل الكتابة والنصوص من السبورة. يمكنك التراجع بزر «تراجع» بعد المسح. متابعة؟', 'مسح')) board.clearAll();
  }
  if (act === 'grid') { board.setGrid(!board.grid); $('grid-state').textContent = board.grid ? 'تشغيل' : 'إيقاف'; }
});

// ---------- محرر النص ----------
let editing = null; // {obj, isNew, before}
function openEditor(obj, isNew) {
  closeEditor(true);
  const o = isNew ? createTextObject({ x: obj.x, y: obj.y, fontSize: lesson.fontSize }) : obj;
  editing = { obj: o, isNew, before: { text: o.text, fontSize: o.fontSize, dir: o.dir }, el: null };
  if (isNew) {
    // معاينة حية للنص الجديد على السبورة قبل اعتماده
    editing.el = document.createElement('div');
    editing.el.className = 'text-obj selected';
    board.layer.appendChild(editing.el);
    board.paintText(editing.el, o);
  }
  $('editor').hidden = false;
  $('editor-title').textContent = isNew ? 'نص جديد' : 'تعديل النص';
  $('editor-delete').hidden = isNew;
  const ta = $('editor-text');
  ta.value = o.text; ta.dir = o.dir; ta.style.fontSize = `${o.fontSize}px`;
  $('editor-size').value = String(o.fontSize);
  $('editor-dir').textContent = o.dir === 'rtl' ? 'الاتجاه: يمين←يسار' : 'الاتجاه: يسار←يمين';
  ta.focus();
}
function closeEditor(commit) {
  if (!editing) return;
  const { obj, isNew, before, el } = editing;
  editing = null;
  el?.remove();
  $('editor').hidden = true;
  if (commit) {
    if (isNew) {
      if (obj.text.trim()) board.commit({ type: 'addObject', object: obj });
    } else {
      const after = { text: obj.text, fontSize: obj.fontSize, dir: obj.dir };
      if (JSON.stringify(after) !== JSON.stringify(before)) board.commit({ type: 'updateObject', id: obj.id, before, after });
    }
  } else if (!isNew) {
    Object.assign(obj, before);
  }
  board.select(null);
  board.syncObjects();
}
function liveEdit() {
  if (!editing) return;
  const el = editing.el || board.elements.get(editing.obj.id);
  if (el) board.paintText(el, editing.obj);
}
$('editor-text').addEventListener('input', (e) => { editing.obj.text = e.target.value; liveEdit(); });
$('editor-size').addEventListener('change', (e) => {
  editing.obj.fontSize = Number(e.target.value);
  $('editor-text').style.fontSize = `${editing.obj.fontSize}px`;
  liveEdit();
});
$('editor-dir').onclick = () => {
  editing.obj.dir = editing.obj.dir === 'rtl' ? 'ltr' : 'rtl';
  $('editor-text').dir = editing.obj.dir;
  $('editor-dir').textContent = editing.obj.dir === 'rtl' ? 'الاتجاه: يمين←يسار' : 'الاتجاه: يسار←يمين';
  liveEdit();
};
$('editor-done').onclick = () => closeEditor(true);
$('editor-delete').onclick = async () => {
  const { obj } = editing;
  editing = null; $('editor').hidden = true; board.select(null);
  const index = lesson.objects.findIndex((o) => o.id === obj.id);
  board.commit({ type: 'removeObject', object: obj, index });
};

// ---------- اختصارات لوحة المفاتيح (للاختبار على الحاسوب) ----------
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? board.redo() : board.undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); board.redo(); }
});

// ---------- الحفظ عند الإخفاء + حالة الاتصال ----------
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saver.flush(); });
window.addEventListener('pagehide', () => saver.flush());
const updateNet = () => { $('net').hidden = navigator.onLine; };
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);
updateNet();

// ---------- Service Worker ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('تعذّر تسجيل Service Worker', e));
}

// لأغراض الاختبار الآلي فقط
window.__app = { board, saver, store, get lesson() { return lesson; } };

await loadInitial();
board.resize();
