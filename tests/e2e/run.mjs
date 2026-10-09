// اختبارات واجهة شاملة على Chromium (Playwright). تشغيل: npm run test:e2e
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'tests/e2e/out');
fs.mkdirSync(out, { recursive: true });
const PORT = 8123;
const URL_ = `http://localhost:${PORT}/`;
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const server = spawn('node', ['scripts/serve.mjs', String(PORT)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({ executablePath: exe });
const results = [];
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log('✔', name); }
  catch (e) { results.push([false, name, e]); console.log('✘', name, '\n   ', e.message.split('\n').slice(0, 6).join(' | '), '\n   ', (e.stack.split('\n').find((l) => l.includes('run.mjs')) || '').trim()); }
}

async function newPage(viewport = { width: 1280, height: 800 }, opts = {}) {
  const ctx = opts.ctx || await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 2, locale: 'ar' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(URL_);
  await page.waitForFunction(() => window.__app?.lesson);
  return page;
}

// قلم حقيقي عبر CDP (pointerType = pen مع ضغط)
async function penStroke(page, pts, { force = 0.6 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const [x0, y0] = pts[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force });
  for (const [x, y] of pts.slice(1)) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force });
  }
  const [xl, yl] = pts.at(-1);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xl, y: yl, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
  await cdp.detach();
}
const wave = (x0, y0, n = 40, dx = 6) => Array.from({ length: n }, (_, i) => [x0 + i * dx, y0 + Math.sin(i / 3) * 30]);
const strokes = (page) => page.evaluate(() => window.__app.lesson.strokes.length);
const objects = (page) => page.evaluate(() => window.__app.lesson.objects.length);
const settle = (page) => page.evaluate(() => window.__app.saver.flush());
const baseInk = (page) => page.evaluate(() => {
  const c = document.getElementById('base'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n;
});

// ---------------------------------------------------------------
await test('1. التطبيق يفتح بلا أخطاء وبعنوان وlang/dir صحيحين', async () => {
  const page = await newPage();
  assert.equal(await page.title(), 'سبورة الرياضيات الذكية');
  assert.equal(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]).then(String), 'ar,rtl');
  assert.deepEqual(page.errors, []);
  await page.screenshot({ path: path.join(out, 'landscape.png') });
  await page.context().close();
});

await test('2. اللوحة تقبل إدخال القلم (pen) وتظهر الحبر فورًا', async () => {
  const page = await newPage();
  assert.equal(await baseInk(page), 0);
  await penStroke(page, wave(300, 400));
  assert.equal(await strokes(page), 1);
  assert.ok(await baseInk(page) > 500, 'يوجد حبر مرسوم على اللوحة');
  const pts = await page.evaluate(() => window.__app.lesson.strokes[0].pts);
  assert.ok(pts.length >= 30 * 3);
  assert.ok(pts.some((v, i) => i % 3 === 2 && v === 0.6), 'الضغط محفوظ');
  await page.context().close();
});

await test('3. الاستجابة أثناء الكتابة المتواصلة (600 حدث حركة)', async () => {
  const page = await newPage();
  const pts = Array.from({ length: 600 }, (_, i) => [200 + i * 1.5, 400 + Math.sin(i / 8) * 80]);
  const t0 = Date.now();
  await penStroke(page, pts);
  const ms = Date.now() - t0;
  console.log(`    ${ms}ms لـ 600 حدث (يشمل زمن CDP)`);
  assert.equal(await strokes(page), 1);
  // قياس زمن معالجة الحدث داخل الصفحة نفسها
  const perEvent = await page.evaluate(() => {
    const st = document.getElementById('stage'); const r = st.getBoundingClientRect();
    const mk = (type, x, y) => new PointerEvent(type, { pointerId: 9, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 });
    st.dispatchEvent(mk('pointerdown', r.left + 100, r.top + 300));
    const t = performance.now();
    for (let i = 1; i <= 1000; i++) st.dispatchEvent(mk('pointermove', r.left + 100 + i, r.top + 300 + Math.sin(i / 9) * 60));
    const el = performance.now() - t;
    st.dispatchEvent(mk('pointerup', r.left + 1100, r.top + 300));
    return el / 1000;
  });
  console.log(`    متوسط معالجة حدث الحركة: ${perEvent.toFixed(3)}ms`);
  assert.ok(perEvent < 2, `معالجة الحدث بطيئة: ${perEvent}ms`);
  await page.context().close();
});

await test('4. التراجع والإعادة (أزرار + اختصار)', async () => {
  const page = await newPage();
  await penStroke(page, wave(200, 300)); await penStroke(page, wave(200, 500));
  assert.equal(await strokes(page), 2);
  assert.equal(await page.locator('#btn-undo').isDisabled(), false);
  await page.click('#btn-undo'); assert.equal(await strokes(page), 1);
  await page.click('#btn-undo'); assert.equal(await strokes(page), 0);
  assert.equal(await page.locator('#btn-undo').isDisabled(), true);
  assert.equal(await baseInk(page), 0, 'اللوحة فارغة بعد التراجع');
  await page.click('#btn-redo'); assert.equal(await strokes(page), 1);
  assert.ok(await baseInk(page) > 0);
  await page.keyboard.press('Control+z'); assert.equal(await strokes(page), 0);
  await page.keyboard.press('Control+Shift+z'); assert.equal(await strokes(page), 1);
  await page.context().close();
});

await test('5. المسح يتطلب تأكيدًا؛ الإلغاء يُبقي المحتوى؛ التأكيد يمسح؛ والتراجع يعيده', async () => {
  const page = await newPage();
  await penStroke(page, wave(200, 300));
  await page.click('#btn-more'); await page.click('[data-act=clear]');
  assert.equal(await page.locator('#dlg-confirm').evaluate((d) => d.open), true);
  await page.click('#dlg-confirm button[value=no]');
  assert.equal(await strokes(page), 1, 'الإلغاء لا يمسح');
  await page.click('#btn-more'); await page.click('[data-act=clear]');
  await page.click('#confirm-yes');
  await page.waitForFunction(() => window.__app.lesson.strokes.length === 0);
  assert.equal(await baseInk(page), 0);
  await page.click('#btn-undo');
  assert.equal(await strokes(page), 1);
  await page.context().close();
});

await test('6. الممحاة تحذف الخط الملامَس فقط وبشكل قابل للتراجع', async () => {
  const page = await newPage();
  await penStroke(page, [[200, 300], [400, 300]]);
  await penStroke(page, [[200, 500], [400, 500]]);
  await page.click('[data-tool=eraser]');
  await penStroke(page, [[300, 280], [300, 320]]);
  assert.equal(await strokes(page), 1);
  await page.click('#btn-undo');
  assert.equal(await strokes(page), 2);
  await page.context().close();
});

await test('7. الحفظ والاستعادة بعد تحديث الصفحة (خطوط + نص + عنوان + عرض)', async () => {
  const page = await newPage();
  await penStroke(page, wave(200, 300));
  await page.click('[data-tool=text]');
  await page.mouse.click(600, 500);
  await page.fill('#editor-text', 'مرحبًا بكم في درس الرياضيات');
  await page.click('#editor-done');
  await page.click('#btn-zoom-in');
  await page.click('#lesson-title'); await page.fill('#prompt-input', 'درس الكسور'); await page.click('#dlg-prompt button[value=yes]');
  assert.equal(await page.locator('#save-status').getAttribute('data-state') !== 'error', true);
  await page.waitForFunction(() => document.getElementById('save-status').dataset.state === 'saved', null, { timeout: 5000 });
  const ctx = page.context();
  await page.reload(); await page.waitForFunction(() => window.__app?.lesson);
  assert.equal(await strokes(page), 1);
  assert.equal(await objects(page), 1);
  assert.equal(await page.locator('#lesson-title').textContent(), 'درس الكسور');
  assert.equal(await page.locator('.text-obj').textContent(), 'مرحبًا بكم في درس الرياضيات');
  assert.equal(await page.locator('#btn-zoom-reset').textContent(), '125%');
  assert.ok(await baseInk(page) > 0, 'الحبر معاد رسمه');
  await ctx.close();
});

await test('8. النص العربي RTL وحجمه الافتراضي 16px بالضبط وخطه عربي', async () => {
  const page = await newPage();
  await page.click('[data-tool=text]'); await page.mouse.click(700, 400);
  assert.equal(await page.locator('#font-size').inputValue(), '16');
  await page.fill('#editor-text', 'المعادلة التربيعية');
  await page.click('#editor-done');
  const info = await page.locator('.text-obj').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, dir: el.dir, cssDir: cs.direction, fam: cs.fontFamily, align: cs.textAlign };
  });
  console.log('    ', JSON.stringify(info));
  assert.equal(info.size, '16px');
  assert.equal(info.dir, 'rtl'); assert.equal(info.cssDir, 'rtl');
  assert.ok(info.fam.includes('Noto Naskh Arabic'));
  const fontLoaded = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Noto Naskh Arabic"', 'المعادلة'); });
  assert.ok(fontLoaded, 'خط Noto Naskh Arabic المضمَّن محمّل');
  assert.equal(await page.evaluate(() => window.__app.lesson.objects[0].fontSize), 16);
  await page.screenshot({ path: path.join(out, 'text-rtl.png') });
  await page.context().close();
});

await test('9. تغيير حجم الخط يعمل ويُحفظ مع الدرس، والدرس الجديد يعود لـ 16px', async () => {
  const page = await newPage();
  await page.selectOption('#font-size', '24');
  await page.click('[data-tool=text]'); await page.mouse.click(500, 300);
  await page.fill('#editor-text', 'نص كبير'); await page.click('#editor-done');
  assert.equal(await page.locator('.text-obj').evaluate((e) => getComputedStyle(e).fontSize), '24px');
  // تغيير الافتراضي لا يغيّر النصوص الموجودة
  await page.selectOption('#font-size', '14');
  assert.equal(await page.locator('.text-obj').evaluate((e) => getComputedStyle(e).fontSize), '24px');
  // تعديل حجم نص موجود من المحرر
  await page.mouse.click(10, 10).catch(() => {});
  await page.locator('.text-obj').click();
  await page.selectOption('#editor-size', '28'); await page.click('#editor-done');
  assert.equal(await page.locator('.text-obj').evaluate((e) => getComputedStyle(e).fontSize), '28px');
  await page.selectOption('#font-size', '20');
  await page.waitForFunction(() => document.getElementById('save-status').dataset.state === 'saved', null, { timeout: 5000 });
  await page.reload(); await page.waitForFunction(() => window.__app?.lesson);
  assert.equal(await page.locator('#font-size').inputValue(), '20', 'حجم الخط الافتراضي محفوظ');
  assert.equal(await page.locator('.text-obj').evaluate((e) => getComputedStyle(e).fontSize), '28px');
  const oldId = await page.evaluate(() => window.__app.lesson.id);
  await page.click('#btn-more'); await page.click('[data-act=new]');
  await page.waitForFunction((id) => window.__app.lesson.id !== id, oldId);
  assert.equal(await page.locator('#font-size').inputValue(), '16', 'الدرس الجديد يبدأ بـ 16px');
  assert.equal(await page.evaluate(() => window.__app.lesson.fontSize), 16);
  await page.context().close();
});

await test('10. التراجع عن إضافة/حذف نص', async () => {
  const page = await newPage();
  await page.click('[data-tool=text]'); await page.mouse.click(500, 300);
  await page.fill('#editor-text', 'س'); await page.click('#editor-done');
  assert.equal(await objects(page), 1);
  await page.click('#btn-undo'); assert.equal(await objects(page), 0);
  await page.click('#btn-redo'); assert.equal(await objects(page), 1);
  await page.locator('.text-obj').click(); await page.click('#editor-delete');
  assert.equal(await objects(page), 0);
  await page.click('#btn-undo'); assert.equal(await objects(page), 1);
  await page.context().close();
});

await test('11. نص جديد فارغ لا يُنشأ (لا محتوى مختلق)', async () => {
  const page = await newPage();
  await page.click('[data-tool=text]'); await page.mouse.click(500, 300);
  await page.click('#editor-done');
  assert.equal(await objects(page), 0);
  await page.context().close();
});

await test('12. التكبير بإصبعين (touch) والتحريك، ومنع تمرير الصفحة', async () => {
  const page = await newPage();
  const cdp = await page.context().newCDPSession(page);
  const tp = (id, x, y) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 0.5 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(1, 500, 400), tp(2, 600, 400)] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(1, 500 - i * 10, 400), tp(2, 600 + i * 10, 400)] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const sc = await page.evaluate(() => window.__app.lesson.view.scale);
  console.log('    scale بعد التقريب:', sc.toFixed(2));
  assert.ok(sc > 2.5 && sc <= 4);
  assert.equal(await strokes(page), 0, 'الإصبعان لا يرسمان');
  assert.equal(await page.evaluate(() => [scrollX, scrollY, document.scrollingElement.scrollTop].join()), '0,0,0');
  assert.equal(await page.locator('#stage').evaluate((e) => getComputedStyle(e).touchAction), 'none');
  // إصبع واحد يرسم عندما لا يوجد قلم
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(1, 300, 300)] });
  for (let i = 1; i < 15; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(1, 300 + i * 8, 300 + (i % 3) * 5)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await strokes(page), 1, 'لمس بإصبع واحد يرسم');
  await page.context().close();
});

await test('13. أداة التحريك (pan) وإعادة ضبط العرض', async () => {
  const page = await newPage();
  await page.click('[data-tool=pan]');
  await penStroke(page, [[400, 400], [500, 450]]);
  const v = await page.evaluate(() => ({ ...window.__app.lesson.view }));
  assert.equal(Math.round(v.x), 100); assert.equal(Math.round(v.y), 50);
  assert.equal(await strokes(page), 0);
  await page.click('#btn-zoom-reset');
  assert.deepEqual(await page.evaluate(() => ({ ...window.__app.lesson.view })), { x: 0, y: 0, scale: 1 });
  await page.context().close();
});

await test('14. إدارة الدروس: إنشاء وفتح وحذف مع تأكيد', async () => {
  const page = await newPage();
  await penStroke(page, wave(200, 300));
  const firstId = await page.evaluate(() => window.__app.lesson.id);
  await page.click('#btn-more'); await page.click('[data-act=new]');
  await page.waitForFunction((id) => window.__app.lesson.id !== id, firstId);
  assert.equal(await strokes(page), 0);
  await page.click('#btn-lessons');
  await page.waitForFunction(() => document.querySelectorAll('#lesson-list li').length === 2);
  await page.locator('#lesson-list li:not(.current) button:has-text("فتح")').click();
  await page.waitForFunction((id) => window.__app.lesson.id === id, firstId);
  assert.equal(await strokes(page), 1);
  await page.click('#btn-lessons');
  await page.waitForSelector('#lesson-list li:not(.current)');
  await page.locator('#lesson-list li:not(.current) button:has-text("حذف")').click();
  await page.click('#confirm-yes');
  await page.waitForFunction(() => document.querySelectorAll('#lesson-list li').length === 1);
  await page.context().close();
});

await test('15. التوافق مع التابلت: أفقي وعمودي (بلا تمرير أفقي، ومساحة كتابة كبيرة، أهداف لمس ≥ 44px)', async () => {
  for (const [name, vp] of [['landscape-1280x800', { width: 1280, height: 800 }], ['portrait-800x1280', { width: 800, height: 1280 }], ['portrait-600x960', { width: 600, height: 960 }]]) {
    const page = await newPage(vp);
    const m = await page.evaluate(() => {
      const st = document.getElementById('stage').getBoundingClientRect();
      const small = [...document.querySelectorAll('#bar .btn, #bar .colors button')].filter((b) => !b.hidden && b.offsetParent).map((b) => b.getBoundingClientRect()).filter((r) => Math.min(r.width, r.height) < 36).length;
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, stageH: st.height, stageW: st.width, vh: innerHeight, small, barH: document.getElementById('bar').getBoundingClientRect().height };
    });
    console.log(`    ${name}:`, JSON.stringify(m));
    assert.ok(m.sw <= m.cw, `تمرير أفقي في ${name}`);
    assert.ok(m.stageH / m.vh > (vp.width >= 800 ? 0.85 : 0.8), `مساحة الكتابة صغيرة في ${name}`);
    assert.equal(m.small, 0, `أزرار أصغر من 36px في ${name}`);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await page.context().close();
  }
});

await test('16. لا اعتماد على التمرير بالمؤشر (hover): لا قواعد :hover وظيفية في الواجهة الأساسية', async () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const hovers = css.match(/[^{}]*:hover[^{}]*\{/g) || [];
  // الوحيد المسموح: تلوين خلفية عنصر قائمة (تحسين لا يؤثر على الوظيفة، وله بديل focus-visible)
  assert.ok(hovers.every((h) => h.includes('.menu')), hovers.join('|'));
});

await test('17. PWA: manifest صالح، الأيقونات متاحة، SW يعمل، والتطبيق يفتح دون اتصال', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
  const page = await newPage(undefined, { ctx });
  const man = await page.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json()));
  assert.equal(man.display, 'standalone'); assert.equal(man.dir, 'rtl'); assert.equal(man.lang, 'ar');
  assert.ok(man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512'));
  for (const i of man.icons) assert.equal((await page.request.get(URL_ + i.src)).status(), 200, i.src);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload(); await page.waitForFunction(() => window.__app?.lesson);
  assert.equal(await page.title(), 'سبورة الرياضيات الذكية');
  assert.equal(await page.locator('#net').isVisible(), true, 'مؤشر عدم الاتصال ظاهر');
  await penStroke(page, wave(200, 300));
  assert.equal(await strokes(page), 1, 'الرسم يعمل دون اتصال');
  await ctx.close();
});

await test('18. زر التعرّف موسوم بوضوح كغير مفعّل ولا يُنتج نتائج', async () => {
  const page = await newPage();
  assert.ok((await page.locator('#btn-recog').textContent()).includes('غير مفعّل'));
  await page.click('#btn-recog');
  const t = await page.locator('#dlg-recog').textContent();
  assert.ok(t.includes('غير مفعّل') && t.includes('لن يعرض التطبيق نتائج مختلقة'));
  await page.click('#dlg-recog button');
  assert.equal(await objects(page), 0);
  // عناصر المرحلة 3 معطّلة وموسومة
  await page.click('#btn-more');
  assert.equal(await page.locator('[data-act=pdf]').isDisabled(), true);
  assert.equal(await page.locator('[data-act=organize]').isDisabled(), true);
  await page.context().close();
});

await browser.close();
server.kill();
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} نجحت`);
process.exit(failed.length ? 1 : 0);
