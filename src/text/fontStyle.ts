const genericFamilies = new Set(['sans-serif', 'serif', 'monospace']);

/** Formats an already resolved family without consulting mutable font registration. */
export function fontStyle(actual: string, size: number, bold = false, italic = false): string {
  const escaped = `"${actual.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]/g, ' ')}"`;
  return `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${size}px ${genericFamilies.has(actual) ? actual : escaped}, sans-serif`;
}
