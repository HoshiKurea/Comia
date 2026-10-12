import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fontCatalogStore, loadLocalFontCatalog } from '../../src/text/fontCatalog';
const mocks = vi.hoisted(() => ({ available: vi.fn(), register: vi.fn() }));
vi.mock('../../src/text/fonts', () => ({ localFontAvailable: mocks.available, registerLocalFontFamilies: mocks.register }));
beforeEach(() => { fontCatalogStore.setState({ families: [], loading: false, message: '' }); mocks.available.mockReset(); mocks.register.mockReset(); });
afterEach(() => { Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: undefined }); });
function native(query: () => Promise<unknown[]>) { Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true }); Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: query }); }
describe('local-only user-invoked font catalog', () => {
  it('calls the native API synchronously, merges font faces into unique families and rejects malformed names', async () => {
    const query = vi.fn().mockResolvedValue([{ family: 'Segoe UI' }, { family: 'Segoe UI' }, { family: 'Arial' }, { family: '' }, { family: 'bad\nfamily' }, { family: 'a'.repeat(129) }, { family: 'serif' }]); native(query);
    expect(query).not.toHaveBeenCalled(); const result = loadLocalFontCatalog(); expect(query).toHaveBeenCalledOnce(); expect(fontCatalogStore.getState().loading).toBe(true);
    expect(await result).toEqual({ ok: true, value: ['Arial', 'Segoe UI'] }); expect(mocks.register).toHaveBeenCalledWith(['Arial', 'Segoe UI']); expect(fontCatalogStore.getState().loading).toBe(false);
  });
  it('shares concurrent calls and permission refusal keeps the earlier list and supports retry', async () => {
    fontCatalogStore.setState({ families: ['Arial'] }); let reject!: (error: unknown) => void;
    const query = vi.fn(() => new Promise<unknown[]>((_resolve, no) => { reject = no; })); native(query); const first = loadLocalFontCatalog(); expect(loadLocalFontCatalog()).toBe(first); expect(query).toHaveBeenCalledOnce(); reject(new DOMException('denied', 'NotAllowedError'));
    expect((await first).ok).toBe(false); expect(fontCatalogStore.getState().families).toEqual(['Arial']); expect(fontCatalogStore.getState().message).toContain('未获'); expect(fontCatalogStore.getState().loading).toBe(false);
    native(async () => [{ family: 'Times New Roman' }]); expect((await loadLocalFontCatalog()).ok).toBe(true); expect(fontCatalogStore.getState().families).toEqual(['Times New Roman']);
  });
  it('unsupported enumeration lists only positively detected common families without calling native access', async () => {
    Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: undefined }); mocks.available.mockImplementation((family) => family === 'Arial');
    expect(await loadLocalFontCatalog()).toEqual({ ok: true, value: ['Arial'] }); expect(fontCatalogStore.getState().message).toContain('不支持完整枚举');
  });
  it('policy rejection gives a specific failure without inventing available families', async () => {
    native(() => { throw new DOMException('blocked', 'SecurityError'); }); expect((await loadLocalFontCatalog()).ok).toBe(false); expect(fontCatalogStore.getState().families).toEqual([]); expect(fontCatalogStore.getState().message).toContain('站点权限');
  });
});
