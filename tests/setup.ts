import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // 每个测试用例重置模块级缓存/计数器由测试自行处理
});

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom 没有 structuredClone 的旧版本兜底
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = ((v: unknown) => JSON.parse(JSON.stringify(v))) as typeof structuredClone;
}

// jsdom 缺少 crypto.randomUUID 的环境兜底
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...globalThis.crypto,
      randomUUID: () => {
        const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
        return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
      },
    },
  });
}
