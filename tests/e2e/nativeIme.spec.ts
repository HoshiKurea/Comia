import { menuCommand } from './menuHelpers';
import { expect, test } from '@playwright/test';

// CDP sends composition through Blink's native input path. This is not an OS
// candidate-window test: report that distinction even though events are trusted.
test('browser IME path reports event trust and protects Enter, native Emoji deletion and a single complete text transaction', async ({ page, context }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: /^文字/ }).click();
  const point = await page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts') as typeof import('../../src/state/documentStore');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts') as typeof import('../../src/state/sessionStore');
    const { apply, screenMatrix } = await import('/src/' + 'geometry/matrix.ts') as typeof import('../../src/geometry/matrix');
    const project = getDocument().project, layer = Object.values(project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((item) => item.type === 'text')!;
    const viewport = sessionStore.getState().viewportByPage[layer.pageId];
    const box = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
    const position = apply(screenMatrix(project, layer.id, viewport), { x: 20, y: 20 });
    return { x: box.x + position.x, y: box.y + position.y };
  });
  await page.mouse.dblclick(point.x, point.y);
  await page.getByRole('button', { name: '显示编辑输入', exact: true }).click();
  const input = page.getByLabel('编辑文字内容'); await expect(input).toHaveClass(/visible-input/); await expect(input).toBeFocused(); await input.selectText();
  const state = () => page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts') as typeof import('../../src/state/documentStore');
    const { currentTextEdit } = await import('/src/' + 'text/editController.ts') as typeof import('../../src/text/editController');
    const doc = getDocument(), edit = currentTextEdit(); return { project: doc.project, history: doc.history, edit: edit && { draft: edit.draft, composing: edit.composing } };
  });
  const before = await state();
  await input.evaluate((input) => {
    const events: { type: string; trusted: boolean; composing?: boolean }[] = [];
    (window as unknown as { nativeImeEvents: typeof events }).nativeImeEvents = events;
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input', 'keydown']) input.addEventListener(type, (event) => events.push({ type, trusted: event.isTrusted, composing: 'isComposing' in event ? Boolean(event.isComposing) : undefined }));
  });
  const client = await context.newCDPSession(page);
  await client.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
  await expect(input).toHaveValue('nihao'); expect((await state()).edit?.composing).toBe(true);
  // A real IME consumes the character phase when selecting a candidate.
  // CDP has no OS candidate window: deliver its raw key phases separately,
  // rather than adding Playwright's unrelated CR character to the textarea.
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await expect(input).toBeVisible();
  expect((await state()).project).toEqual(before.project); expect((await state()).history).toEqual(before.history);
  await client.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
  await client.send('Input.insertText', { text: '你好' });
  await expect(input).toHaveValue('你好'); expect((await state()).edit?.composing).toBe(false);
  await page.keyboard.press('Enter'); await expect(input).toBeFocused(); await expect(input).toHaveValue('你好\n');
  expect((await state()).history).toEqual(before.history);
  await page.keyboard.press('Backspace'); await expect(input).toHaveValue('你好');
  await input.press('End'); await client.send('Input.insertText', { text: '😀' }); await expect(input).toHaveValue('你好😀');
  await input.press('Backspace'); await expect(input).toHaveValue('你好');
  const paragraphs = Array.from({ length: 10 }, (_, index) => `第${index + 1}段你好😀`).join('\n');
  await input.selectText(); await client.send('Input.insertText', { text: paragraphs });
  await input.press('Control+Enter'); await expect(input).toHaveCount(0);
  const committed = await state(); expect(committed.history.past).toHaveLength(before.history.past.length + 1);
  await (await menuCommand(page, '撤销')).click(); expect((await state()).project).toEqual(before.project);
  await (await menuCommand(page, '重做')).click(); expect((await state()).project).toEqual(committed.project);
  await page.getByRole('button', { name: '编辑文字', exact: true }).click(); await input.fill('Esc还原'); await input.press('Escape');
  expect((await state()).project).toEqual(committed.project);
  const events = await page.evaluate(() => (window as unknown as { nativeImeEvents: { type: string; trusted: boolean; composing?: boolean }[] }).nativeImeEvents);
  console.log(JSON.stringify({ scope: 'Blink IME pipeline via CDP, not OS candidate UI', events, exactUndoRedo: true, nativeEmojiBackspace: true }));
  expect(events.some((event) => event.type === 'compositionstart')).toBe(true); expect(events.some((event) => event.type === 'compositionend')).toBe(true);
  // Edge's CDP commit emits an untrusted compositionend, even though the
  // start/update/input/raw-key events are trusted. Preserve that platform
  // observation instead of relabelling the whole trace as OS-native input.
  expect(events.filter((event) => event.type !== 'compositionend').every((event) => event.trusted)).toBe(true);
  expect(events.some((event) => event.type === 'keydown' && event.composing)).toBe(true);
});
