import { menuCommand } from './menuHelpers';
import { test, expect } from '@playwright/test';

function sharedDirectoryPicker() {
  class Directory {
    kind = 'directory' as const;
    constructor(public path = 'root') {}
    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Directory> {
      const path = `${this.path}/${name}`, key = `comia-dir-${path}`;
      if (!localStorage.getItem(key) && !options?.create) throw new DOMException('missing', 'NotFoundError');
      if (options?.create) localStorage.setItem(key, '1');
      return new Directory(path);
    }
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const key = `comia-file-${this.path}/${name}`;
      if (localStorage.getItem(key) === null && !options?.create) throw new DOMException('missing', 'NotFoundError');
      return {
        kind: 'file', name,
        getFile: async () => new File([localStorage.getItem(key) ?? ''], name),
        createWritable: async () => {
          let content = '';
          return { write: async (data: Blob) => { content = await data.text(); }, close: async () => { localStorage.setItem(key, content); }, abort: async () => undefined };
        },
      };
    }
    async *entries(): AsyncIterable<[string, { kind: string }]> {
      const prefix = `comia-file-${this.path}/`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) yield [key.slice(prefix.length), { kind: 'file' }];
      }
    }
  }
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => new Directory() });
}

test('directory save reloads a verified generation and offers recovery after pointer damage', async ({ page }) => {
  await page.addInitScript(() => {
    class Directory {
      kind = 'directory' as const;
      files = new Map<string, Blob>();
      dirs = new Map<string, Directory>();
      constructor(public name = 'Comia test directory') {}
      async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Directory> {
        let dir = this.dirs.get(name);
        if (!dir && options?.create) { dir = new Directory(name); this.dirs.set(name, dir); }
        if (!dir) throw new DOMException('missing', 'NotFoundError');
        return dir;
      }
      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!this.files.has(name) && !options?.create) throw new DOMException('missing', 'NotFoundError');
        return {
          kind: 'file', name,
          getFile: async () => new File([this.files.get(name) ?? new Blob()], name),
          createWritable: async () => {
            let written = new Blob();
            return { write: async (value: Blob) => { written = value; }, close: async () => { this.files.set(name, written); }, abort: async () => undefined };
          },
        };
      }
      async *entries(): AsyncIterable<[string, { kind: string }]> {
        for (const name of this.files.keys()) yield [name, { kind: 'file' }];
        for (const name of this.dirs.keys()) yield [name, { kind: 'directory' }];
      }
    }
    const root = new Directory();
    (window as unknown as { __testDirectory: Directory }).__testDirectory = root;
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
  });
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await page.getByRole('button', { name: /矩形分镜/ }).click();
  await page.mouse.click(x, y);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await (await menuCommand(page, '保存目录')).click();
  await expect(page.getByText('项目目录已写入并校验')).toBeVisible();
  await expect(page.locator('.unsaved')).toContainText('已保存');
  await page.evaluate(() => {
    const root = (window as unknown as { __testDirectory: { files: Map<string, Blob> } }).__testDirectory;
    root.files.set('current.json', new Blob(['{broken']));
  });
  await (await menuCommand(page, '打开目录')).click();
  await expect(page.getByText('选择可恢复的目录版本')).toBeVisible();
  await page.getByRole('button', { name: '恢复此版本' }).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await expect(page.getByText('选择可恢复的目录版本')).toHaveCount(0);
  await page.locator('.library-item').filter({ hasText: '对白气泡' }).click();
  await page.mouse.click(x + 70, y);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.evaluate(() => {
    const root = (window as unknown as { __testDirectory: { files: Map<string, Blob> } }).__testDirectory;
    root.files.set('current.json', new Blob(['{broken']));
  });
  await (await menuCommand(page, '保存目录')).click();
  await expect(page.getByText('项目目录已被修改')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
});

test('two tabs reject a stale directory save while keeping the second tab edits', async ({ context }) => {
  const first = await context.newPage(), second = await context.newPage();
  await first.addInitScript(sharedDirectoryPicker);
  await second.addInitScript(sharedDirectoryPicker);
  await first.goto('/');
  await first.getByRole('button', { name: /矩形分镜/ }).click();
  const rectA = await first.locator('.canvas-viewport').boundingBox();
  await first.mouse.click(rectA!.x + rectA!.width / 2, rectA!.y + rectA!.height / 2);
  await (await menuCommand(first, '保存目录')).click();
  await expect(first.locator('.unsaved')).toContainText('已保存');
  await second.goto('/');
  await (await menuCommand(second, '打开目录')).click();
  await expect(second.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await first.locator('.library-item').filter({ hasText: '对白气泡' }).click();
  await first.mouse.click(rectA!.x + rectA!.width / 2 + 70, rectA!.y + rectA!.height / 2);
  await expect(first.locator('.unsaved')).toContainText('未保存');
  await (await menuCommand(first, '保存目录')).click();
  await expect(first.locator('.unsaved')).toContainText('已保存');
  const rectB = await second.locator('.canvas-viewport').boundingBox();
  await second.locator('.library-item').filter({ hasText: '文字' }).click();
  await second.mouse.click(rectB!.x + rectB!.width / 2 + 70, rectB!.y + rectB!.height / 2);
  await expect(second.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await (await menuCommand(second, '保存目录')).click();
  await expect(second.getByText('项目目录已被修改')).toBeVisible();
  await second.getByRole('button', { name: '取消', exact: true }).click();
  await expect(second.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
});

test('without directory picker, the self-contained file save remains available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect((await menuCommand(page, '保存目录'))).toBeDisabled();
  await expect((await menuCommand(page, '打开目录'))).toBeDisabled();
  const download = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  expect((await download).suggestedFilename()).toMatch(/\.Comia\.json$/);
  await expect(page.getByText('已生成下载，请确认文件已保存')).toBeVisible();
});
