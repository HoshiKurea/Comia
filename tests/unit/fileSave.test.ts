import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentProject as createProject } from '../helpers/contentProject';
import { replaceDocument } from '../../src/history/commandBus';
import { saveFile, clearActiveFileHandle } from '../../src/storage/fileSave';
import { getDocument } from '../../src/state/documentStore';

const originalPicker = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
const originalSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
beforeEach(() => { clearActiveFileHandle(); Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true }); });
afterEach(() => {
  clearActiveFileHandle();
  if (originalPicker) Object.defineProperty(window, 'showSaveFilePicker', originalPicker); else delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  if (originalSecure) Object.defineProperty(window, 'isSecureContext', originalSecure); else Reflect.deleteProperty(window, 'isSecureContext');
});

describe('file save gesture and verification', () => {
  it('requests a picker before the first encoding await and marks only a completed write as saved', async () => {
    expect(replaceDocument(createProject()).ok).toBe(true);
    let calls = 0, writes = 0, closes = 0;
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: () => {
      calls++;
      return Promise.resolve({ createWritable: async () => ({ write: async (_blob: Blob) => { writes++; }, close: async () => { closes++; } }) });
    } });
    const pending = saveFile();
    expect(calls).toBe(1);
    expect(getDocument().savedStateId).toBeNull();
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.verified).toBe(true);
    expect(writes).toBe(1);
    expect(closes).toBe(1);
    expect(getDocument().savedStateId).toBe(getDocument().history.stateId);
  });
  it('cancelling Save As retains the existing target for a subsequent normal save', async () => {
    replaceDocument(createProject()); const write = vi.fn(async () => undefined), picker = vi.fn().mockResolvedValueOnce({ createWritable: async () => ({ write, close: async () => undefined }) }).mockRejectedValueOnce(new DOMException('cancel', 'AbortError'));
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker }); expect((await saveFile()).ok).toBe(true); expect((await saveFile(undefined, true)).ok).toBe(false); expect((await saveFile()).ok).toBe(true); expect(picker).toHaveBeenCalledTimes(2); expect(write).toHaveBeenCalledTimes(2);
  });
  it('aborts an uncommitted stream after cancellation instead of closing it or clearing the dirty marker', async () => {
    replaceDocument(createProject()); const controller = new AbortController(), close = vi.fn(async () => undefined), abort = vi.fn(async () => undefined);
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({ createWritable: async () => ({ write: async () => controller.abort(), close, abort }) }) });
    const result = await saveFile(controller.signal); expect(result.ok).toBe(false); expect(close).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalledOnce(); expect(getDocument().savedStateId).toBeNull();
  });
  it('does not attach an old picker result to a replacement project', async () => {
    replaceDocument(createProject()); let resolvePicker!: (value: unknown) => void;
    const handle = { createWritable: async () => ({ write: async () => undefined, close: async () => undefined }) }, picker = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolvePicker = resolve; })).mockResolvedValue(handle);
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker }); const pending = saveFile(); replaceDocument(createProject()); resolvePicker(handle); expect((await pending).ok).toBe(true); expect(getDocument().savedStateId).toBeNull();
    expect((await saveFile()).ok).toBe(true); expect(picker).toHaveBeenCalledTimes(2);
  });
});
