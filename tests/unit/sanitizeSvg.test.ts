import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '../../src/assets/sanitizeSvg';

const encode = (value: string) => new TextEncoder().encode(value).buffer;

describe('SVG import boundary', () => {
  it('accepts a bounded local gradient and supplies pixel dimensions from viewBox', async () => {
    const value = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="120" height="80" fill="url(#g)"/></svg>';
    const result = sanitizeSvg(encode(value));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(result.value); });
      expect(output).toContain('width="120"');
      expect(output).toContain('height="80"');
    }
  });

  it('rejects missing references, scripts, external links, entities and unbounded sizes', () => {
    const wrap = (child: string, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ${extra}>${child}</svg>`;
    expect(sanitizeSvg(encode(wrap('<rect fill="url(#missing)"/>'))).ok).toBe(false);
    expect(sanitizeSvg(encode(wrap('<script>alert(1)</script>'))).ok).toBe(false);
    expect(sanitizeSvg(encode(wrap('<image href="https://example.com/a.png"/>'))).ok).toBe(false);
    expect(sanitizeSvg(encode(`<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${wrap('<rect/>')}`)).ok).toBe(false);
    expect(sanitizeSvg(encode(wrap('<rect/>', 'width="999999999"'))).ok).toBe(false);
    expect(sanitizeSvg(encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).ok).toBe(false);
  });
});
