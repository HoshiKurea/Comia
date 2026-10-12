import type { Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { LIMITS } from '../domain/limits';

const ALLOWED = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath']);
const ATTRS = new Set(['xmlns', 'viewBox', 'width', 'height', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'clip-path']);
const URL_REF = /^url\(#([A-Za-z_][A-Za-z0-9_-]*)\)$/;
const LENGTH = /^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/;

function sizeValue(raw: string | null): number | null {
  if (raw === null || !LENGTH.test(raw.trim())) return null;
  const n = Number(raw.trim().replace(/px$/, ''));
  return Number.isFinite(n) && n >= 1 && n <= 16384 ? n : null;
}

export function sanitizeSvg(bytes: ArrayBuffer): Result<Blob> {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) return fail(problem('image/svg-entity', 'SVG不能包含DOCTYPE、实体或外部样式表'));
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return fail(problem('image/svg-parse', 'SVG格式无效'));
  if (doc.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg') return fail(problem('image/svg-namespace', 'SVG命名空间无效'));
  const ids = new Set<string>();
  for (const node of Array.from(doc.querySelectorAll('*'))) {
    if (!ALLOWED.has(node.localName)) return fail(problem('image/svg-unsupported', `SVG含未支持元素 ${node.localName}，请转PNG`));
    const id = node.getAttribute('id');
    if (id) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) || ids.has(id)) return fail(problem('image/svg-id', 'SVG id无效或重复，请转PNG'));
      ids.add(id);
    }
  }
  for (const node of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(node.attributes)) {
      if (!ATTRS.has(attr.name)) return fail(problem('image/svg-unsafe', `SVG含未支持属性 ${attr.name}，请转PNG`));
      const value = attr.value.trim();
      if (attr.name === 'xmlns') {
        if (value !== 'http://www.w3.org/2000/svg') return fail(problem('image/svg-namespace', 'SVG命名空间无效'));
        continue;
      }
      if (/url\s*\(/i.test(value)) {
        const match = URL_REF.exec(value);
        if (!match || !ids.has(match[1]) || !['fill', 'stroke', 'clip-path'].includes(attr.name)) return fail(problem('image/svg-url', 'SVG引用必须指向本文件内合法id，请转PNG'));
      }
      if (/javascript:|data:|https?:|file:|\\|[<>]/i.test(value)) return fail(problem('image/svg-unsafe', `SVG属性 ${attr.name} 包含不安全内容，请转PNG`));
    }
  }
  const root = doc.documentElement;
  const rawBox = root.getAttribute('viewBox');
  let boxWidth: number | null = null, boxHeight: number | null = null;
  if (rawBox !== null) {
    const parts = rawBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0 || parts[2] > 16384 || parts[3] > 16384 || parts[2] * parts[3] > LIMITS.maxAssetPixels) return fail(problem('image/svg-viewbox', 'SVG viewBox无效或过大'));
    boxWidth = parts[2]; boxHeight = parts[3];
  }
  const width = root.hasAttribute('width') ? sizeValue(root.getAttribute('width')) : boxWidth;
  const height = root.hasAttribute('height') ? sizeValue(root.getAttribute('height')) : boxHeight;
  if (!width || !height || width > 16384 || height > 16384 || width * height > LIMITS.maxAssetPixels) return fail(problem('image/svg-size', 'SVG需要有界viewBox或1～16384像素宽高，且不超过40MP'));
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  return ok(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
}
