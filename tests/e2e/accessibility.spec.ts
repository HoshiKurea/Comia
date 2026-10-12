import { menuCommand, setMenuScale } from './menuHelpers';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type * as Documents from '../../src/state/documentStore';
import type * as Sessions from '../../src/state/sessionStore';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { documentStore } = await import('/src/' + 'state/documentStore.ts') as typeof Documents;
    const state = documentStore.getState();
    return { project: state.project, history: state.history, epoch: state.epoch };
  });
}
async function reach(page: Page, control: Locator) {
  if(await control.evaluate(node=>node.getAttribute('role')==='tab' && !!node.closest('.panel-tabs') && (node as HTMLElement).tabIndex<0)) {
    const active=control.locator('..').locator('[role=tab][tabindex="0"]');await reach(page,active);
    for(let i=0;i<6;i++){if(await control.evaluate(node=>node===document.activeElement))return;await page.keyboard.press('ArrowRight');}throw Error('Panel tab arrow navigation did not reach the target');
  }
  if ((await control.getAttribute('role'))?.startsWith('menuitem') && await control.evaluate(node => !!node.closest('[role=menu]'))) {
    if (await page.getByRole('menubar').evaluate(node => node.contains(document.activeElement))) await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 40; i++) { if (await control.evaluate(node => node === document.activeElement)) return; await page.keyboard.press('ArrowDown'); }
    throw Error('Menu keyboard navigation did not reach the command');
  }
  const trail: unknown[] = [];
  for (let i = 0; i < 250; i++) {
    if (await control.evaluate((node) => node === document.activeElement)) return;
    // Firefox sends focus to browser chrome after the last document control.
    // Reach earlier controls through real reverse traversal, without focus() or a page wrap assumption.
    const backwards = await control.evaluate((node) => Boolean(document.activeElement && document.activeElement.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING));
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    trail.push(await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent?.slice(0, 45), focused: document.hasFocus() })));
  }
  throw Error(`Native Tab never reached ${await control.textContent()}: ${JSON.stringify(trail.slice(-30))}`);
}
async function buttonMatrix(page: Page, scope = 'body') {
  const before = await snapshot(page);
  const expected = await page.evaluate((scope) => {
    document.querySelectorAll('[data-keyboard-audit]').forEach(node => node.removeAttribute('data-keyboard-audit'));
    const buttons = [...document.querySelector(scope)!.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),summary')].filter((node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    return buttons.map((node, index) => { node.dataset.keyboardAudit = String(index); return { id: String(index), name: node.getAttribute('aria-label') || node.textContent?.trim() || node.title }; });
  }, scope);
  expect(expected.length).toBeGreaterThan(scope === 'body' ? 15 : 5); expect(expected.every((item) => Boolean(item.name))).toBe(true);
  const first = page.locator(`${scope} [data-keyboard-audit="0"]`); await reach(page, first);
  expect(await first.evaluate((node) => ({ style: getComputedStyle(node).outlineStyle, width: parseFloat(getComputedStyle(node).outlineWidth) }))).toEqual({ style: 'solid', width: 2 });
  const visited = new Set<string>(['0']);
  for (let i = 0; i < 300 && visited.size < expected.length; i++) {
    await page.keyboard.press('Tab');
    const current = await page.evaluate(() => {
      const node = document.activeElement as HTMLElement | null, style = node ? getComputedStyle(node) : null;
      return { id: node?.dataset.keyboardAudit ?? null, outline: style?.outlineStyle, width: parseFloat(style?.outlineWidth ?? '0') };
    });
    if (current.id !== null) { visited.add(current.id); expect(current.outline).not.toBe('none'); expect(current.width).toBeGreaterThanOrEqual(2); }
  }
  expect([...visited].sort()).toEqual(expected.map((item) => item.id).sort());
  expect(await snapshot(page)).toEqual(before);
}

test('native Tab reaches every enabled major button with visible focus, then keyboard opens the layer menu and closes dialogs back to their actual triggers', async ({ page }) => {
  test.setTimeout(120_000); await page.goto('/');
  await buttonMatrix(page);
  const component = page.locator('.library-item').filter({ hasText: '矩形分镜' });
  await reach(page, component); await page.keyboard.press('Enter'); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  const initial = await snapshot(page); await buttonMatrix(page);
  const row = page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)'); await reach(page, row); await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: '图层操作' }); await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '置顶', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(menu.getByRole('menuitem', { name: '删除', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(row).toBeFocused(); expect(await snapshot(page)).toEqual(initial);
  await page.keyboard.press('Shift+F10'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); await expect(row).toBeFocused();
  const clear = page.getByRole('button', { name: '清空历史', exact: true }); await reach(page, clear); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '清空编辑历史' }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: '确认清空' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Delete'); expect(await snapshot(page)).toEqual(initial);
  await page.keyboard.press('Escape'); await expect(clear).toBeFocused(); expect(await snapshot(page)).toEqual(initial);
  const pages = page.getByRole('tab', { name: '页面', exact: true }); await reach(page, pages); await page.keyboard.press('Enter'); await buttonMatrix(page);
  const create = page.getByRole('button', { name: '+ 新建漫画页', exact: true }); await reach(page, create); await page.keyboard.press('Enter');
  expect((await snapshot(page)).project.pageOrder).toHaveLength(2); await buttonMatrix(page);
  const library = page.getByRole('tab', { name: '组件库', exact: true }); await reach(page, library); await page.keyboard.press('Enter');
  for (const label of ['对白气泡', '文字', '集中线', '音效字']) {
    const item = page.locator('.library-item').filter({ hasText: new RegExp(`^${label}`) }); await reach(page, item); await page.keyboard.press('Enter'); await buttonMatrix(page);
  }
  await page.evaluate(async () => {
    const { documentStore } = await import('/src/' + 'state/documentStore.ts') as typeof Documents;
    const { sessionStore, setSelection } = await import('/src/' + 'state/sessionStore.ts') as typeof Sessions;
    setSelection(documentStore.getState().project.pages[sessionStore.getState().activePageId].roots.filter(id => documentStore.getState().project.layers[id].type !== 'pageBackground').slice(0, 2));
  });
  const group = (await menuCommand(page, '编组')); await reach(page, group); await page.keyboard.press('Enter'); await buttonMatrix(page);
  const copy = (await menuCommand(page, '复制')); await reach(page, copy); await page.keyboard.press('Enter'); await buttonMatrix(page);
  const enter = page.getByRole('button', { name: '进入组', exact: true }); await reach(page, enter); await page.keyboard.press('Enter'); await buttonMatrix(page);
  const exit = page.getByRole('button', { name: '退出组', exact: true }); await reach(page, exit); await page.keyboard.press('Enter');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, scope] of [['组件 / 页面', '.left-panel.drawer-open'], ['属性 / 图层', '.right-panel.drawer-open']]) {
    const trigger = page.getByRole('button', { name, exact: true }); await reach(page, trigger); await page.keyboard.press('Enter');
    await expect(page.locator(scope)).toBeVisible(); await buttonMatrix(page, scope); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  }
});

test('disabled controls explain empty history, cross-parent grouping, locks, container transforms and export budgets without mutating the document', async ({ page }) => {
  await page.goto('/');
  for (const [name, reason] of [['↶ 撤销', '没有可以撤销'], ['↷ 重做', '没有可以重做'], ['复制', '请先选择'], ['粘贴', '请先复制'], ['编组', '至少选择两个']]) {
    const button = await menuCommand(page, name); await expect(button).toBeDisabled(); await expect(button).toHaveAttribute('title', new RegExp(reason));
  }
  await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await page.locator('.library-item').filter({ hasText: '梯形分镜' }).click();
  await page.evaluate(async () => {
    const { groupLayers } = await import('/src/' + 'layers/group.ts') as typeof import('../../src/layers/group');
    const { documentStore } = await import('/src/' + 'state/documentStore.ts') as typeof Documents;
    const { setSelection } = await import('/src/' + 'state/sessionStore.ts') as typeof Sessions;
    const ids = [...documentStore.getState().project.pages[documentStore.getState().project.pageOrder[0]].roots.filter(id => documentStore.getState().project.layers[id].type !== 'pageBackground')], grouped = groupLayers(ids);
    if (!grouped.ok) throw Error(grouped.problems[0].message);
    const { placeComponentAtPageCenter } = await import('/src/' + 'library/placement.ts') as typeof import('../../src/library/placement');
    const created = placeComponentAtPageCenter('rect-panel', documentStore.getState().project.pageOrder[0]); if (!created.ok) throw Error(created.problems[0].message);
    setSelection([ids[0], created.value]);
  });
  const cross = await snapshot(page), group = (await menuCommand(page, '编组'));
  const child = Object.values(cross.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer) => layer.type === 'panel' && layer.parentId)!;
  await expect(group).toBeDisabled(); await expect(group).toHaveAttribute('title', /同页、同父级/);
  await expect(page.locator('.operation-hint')).toContainText('同页、同父级');
  await page.locator('.canvas-viewport').focus(); await page.keyboard.press('Control+g');
  const alert = page.getByRole('alert').filter({ hasText: '同页、同父级' }); await expect(alert).toBeVisible(); await expect(alert).toContainText(child.name);
  expect(await snapshot(page)).toEqual(cross);
  await reach(page, alert.getByRole('button', { name: '返回编辑' })); await page.keyboard.press('Enter');
  await expect(page.getByLabel('对象X')).toBeFocused(); expect((await snapshot(page)).project).toEqual(cross.project); expect((await snapshot(page)).history).toEqual(cross.history);
  await page.locator(`[data-layer-id="${child.parentId}"]`).getByRole('button', { name: '展开图层' }).click();
  await page.locator(`[data-layer-id="${child.id}"]`).locator('button[aria-label="锁定"]:not(.layer-row[data-layer-type="pageBackground"] button)').click();
  await expect(page.getByLabel('对象X')).toBeDisabled(); await expect(page.getByRole('status').filter({ hasText: '祖先已锁定' })).toBeVisible();
  await page.locator('.library-item').filter({ hasText: '对白气泡' }).click();
  const bubble = Object.values((await snapshot(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer) => layer.type === 'bubble')!;
  await page.locator(`[data-layer-id="${bubble.id}"]`).getByRole('button', { name: '展开图层' }).click();
  const owned = 'children' in bubble ? bubble.children[0] : '';
  await page.locator(`[data-layer-id="${owned}"] .layer-name`).click();
  await expect(page.getByLabel('对象X')).toBeDisabled(); await expect(page.getByLabel('对象X')).toHaveAttribute('title', /受容器控制/);
  await page.evaluate(async () => {
    const { resizePage } = await import('/src/' + 'pages/commands.ts') as typeof import('../../src/pages/commands');
    const { documentStore } = await import('/src/' + 'state/documentStore.ts') as typeof Documents;
    const result = resizePage(documentStore.getState().project.pageOrder[0], { preset: 'custom', orientation: 'portrait', widthPx: 16384, heightPx: 16384, dpi: 72 }); if (!result.ok) throw Error(result.problems[0].message);
  });
  const budget = await snapshot(page);
  for (const name of ['PNG', 'PDF']) { const button = await menuCommand(page, name); await expect(button).toBeDisabled(); await expect(button).toHaveAttribute('title', /降低倍率或页面尺寸/); }
  await expect(page.locator('.operation-hint')).toContainText('内存预算');
  await setMenuScale(page, '0.25'); await expect((await menuCommand(page, 'PNG'))).toBeEnabled();
  expect(await snapshot(page)).toEqual(budget);
});

test('native SFX Tab preserves the draft until completion or cancellation and returns focus without swallowing later edits', async ({ page }) => {
  await page.goto('/');await page.getByRole('button',{name:'音效字',exact:true}).click();const before=await snapshot(page);
  const open=async()=>{await reach(page,page.getByRole('button',{name:'编辑文字',exact:true}));await page.keyboard.press('Enter');};await open();const input=page.getByLabel('编辑文字内容');await expect(input).toBeFocused();await input.fill('取消的音效');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'移动编辑文字浮窗',exact:true})).toBeFocused();await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'显示编辑输入',exact:true})).toBeFocused();expect(await snapshot(page)).toEqual(before);await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'取消文字编辑',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('.canvas-viewport')).toBeFocused();expect(await snapshot(page)).toEqual(before);
  await open();await input.fill('已完成的音效');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'移动编辑文字浮窗',exact:true})).toBeFocused();await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'完成',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('.canvas-viewport')).toBeFocused();const committed=await snapshot(page);expect(committed.history.past).toHaveLength(before.history.past.length+1);
  expect(Object.values(committed.project.layers).find(l=>l.type==='text'&&l.role==='sfx')).toMatchObject({text:{content:'已完成的音效'}});await open();await input.fill('下一次取消');await page.keyboard.press('Escape');expect(await snapshot(page)).toEqual(committed);await page.keyboard.press('Control+z');expect((await snapshot(page)).project).toEqual(before.project);
});
test('a real PNG encode-null failure retains an actionable named error for keyboard retry and clears obsolete actions when the project is replaced', async ({ page }) => {
  test.setTimeout(60_000); await page.goto('/');
  await page.evaluate(async () => {
    const { resizePage } = await import('/src/' + 'pages/commands.ts') as typeof import('../../src/pages/commands');
    const { documentStore } = await import('/src/' + 'state/documentStore.ts') as typeof Documents;
    const result = resizePage(documentStore.getState().project.pageOrder[0], { preset: 'custom', orientation: 'portrait', widthPx: 800, heightPx: 600, dpi: 72 }); if (!result.ok) throw Error(result.problems[0].message);
  });
  await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const png = (await menuCommand(page, 'PNG'));
  const download = async (button: Locator) => { await reach(page, button); const pending = page.waitForEvent('download'); await page.keyboard.press('Enter'); return readFile((await (await pending).path())!); };
  const baseline = await download(png), before = await snapshot(page);
  const failNext = () => page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob; let failed = false;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (!failed && this.width === 800 && this.height === 600) { failed = true; HTMLCanvasElement.prototype.toBlob = original; callback(null); return; }
      original.call(this, callback, type, quality);
    };
  });
  await failNext(); await reach(page, await menuCommand(page, 'PNG')); await page.keyboard.press('Enter');
  const alert = page.getByRole('alert').filter({ hasText: 'PNG编码失败' }); await expect(alert).toBeVisible(); await expect(alert).toContainText(before.project.name);
  await page.waitForTimeout(6500); await expect(alert).toBeVisible(); expect(await snapshot(page)).toEqual(before);
  expect(await download(alert.getByRole('button', { name: '重试PNG导出' }))).toEqual(baseline); await expect(alert).toHaveCount(0); expect(await snapshot(page)).toEqual(before);
  await failNext(); await reach(page, await menuCommand(page, 'PNG')); await page.keyboard.press('Enter'); await expect(alert).toBeVisible();
  await page.evaluate(async () => {
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts') as typeof import('../../src/history/commandBus'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { documentStore } = await import('/src/' + 'state/documentStore.ts') as typeof Documents;
    const project = structuredClone(documentStore.getState().project); project.name = '新作品';
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(result.problems[0].message);
  });
  const replacement = await snapshot(page); await expect(page.getByRole('alert')).toHaveCount(0); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '重试PNG导出' })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(replacement);
});
