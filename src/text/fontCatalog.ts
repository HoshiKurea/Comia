import { createStore } from 'zustand/vanilla';
import type { Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { DEFAULT_FONT_FAMILY } from '../domain/factories';
import { localFontAvailable, registerLocalFontFamilies } from './fonts';

export const APPLICATION_FONTS = [DEFAULT_FONT_FAMILY, 'sans-serif', 'serif', 'monospace'];
const COMMON_LOCAL = ['Arial', 'Times New Roman', 'Courier New', 'Segoe UI', 'Microsoft YaHei', 'SimSun', 'SimHei', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC'];
interface LocalFontInfo { family: string }
type FontWindow = Window & { queryLocalFonts?: () => Promise<LocalFontInfo[]> };
export const fontCatalogStore = createStore<{ families: string[]; loading: boolean; message: string }>(() => ({ families: [], loading: false, message: '' }));
let pending: Promise<Result<string[]>> | null = null;

/** Invoked directly by the user's button: native enumeration needs transient activation. Never runs on mount. */
export function loadLocalFontCatalog(): Promise<Result<string[]>> {
  if (pending) return pending;
  const host = window as FontWindow;
  fontCatalogStore.setState({ loading: true, message: '' });
  // Call before any await so the browser receives the original user activation.
  let query: Promise<LocalFontInfo[]>;
  try {
    query = host.isSecureContext && typeof host.queryLocalFonts === 'function' ? host.queryLocalFonts() : Promise.resolve(COMMON_LOCAL.filter(localFontAvailable).map((family) => ({ family })));
  } catch (error) { query = Promise.reject(error); }
  const complete = query.then((faces): Result<string[]> => {
    const families = [...new Set(faces.map((face) => typeof face.family === 'string' ? face.family.trim() : '').filter((family) => family.length > 0 && [...family].length <= 128 && !/[\u0000-\u001f\u007f]/u.test(family) && !APPLICATION_FONTS.includes(family)))].sort((a, b) => a.localeCompare(b, 'zh'));
    registerLocalFontFamilies(families);
    const native = host.isSecureContext && typeof host.queryLocalFonts === 'function';
    fontCatalogStore.setState({ families, message: native ? `已读取${families.length}种本机字体；字体文件不会写入作品或上传` : `浏览器不支持完整枚举，已检测${families.length}种常用本机字体` });
    return ok(families);
  }).catch((error): Result<string[]> => {
    const message = error instanceof DOMException && error.name === 'NotAllowedError' ? '未获本机字体访问权限；仍可使用应用字体，点击可重试'
      : error instanceof DOMException && error.name === 'SecurityError' ? '浏览器阻止本机字体枚举；请使用应用字体或检查站点权限'
      : '本机字体列表读取失败；应用字体仍可使用，点击可重试';
    fontCatalogStore.setState({ message }); return fail(problem('font/catalog', message));
  }).finally(() => { pending = null; fontCatalogStore.setState({ loading: false }); });
  pending = complete; return complete;
}
