import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FloatingEditPanel, constrainFloatingPosition } from '../../src/app/FloatingEditPanel';

const disconnect = vi.fn();
beforeEach(() => {
  disconnect.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(560);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(180);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('constrains every edge, including a panel larger than its viewport', () => {
  expect(constrainFloatingPosition({ x: -100, y: 900 }, { width: 800, height: 600 }, { width: 560, height: 180 })).toEqual({ x: 16, y: 404 });
  expect(constrainFloatingPosition({ x: 900, y: -9 }, { width: 800, height: 600 }, { width: 560, height: 180 })).toEqual({ x: 224, y: 16 });
  expect(constrainFloatingPosition({ x: 90, y: 90 }, { width: 20, height: 10 }, { width: 560, height: 180 })).toEqual({ x: 10, y: 5 });
});
it('opens above the canvas center without stealing focus or trapping keyboard navigation', () => {
  render(<div className="canvas-viewport"><input aria-label="原文字输入" autoFocus /><FloatingEditPanel title="测试编辑"><button>完成</button></FloatingEditPanel></div>);
  const input = screen.getByLabelText('原文字输入'), dialog = screen.getByRole('dialog');
  expect(document.activeElement).toBe(input); expect(dialog.getAttribute('aria-modal')).toBeNull(); expect(dialog.style.transform).toBe('translate(120px, 16px)');
  const handle = screen.getByRole('button', { name: '移动测试编辑浮窗' });
  fireEvent.keyDown(handle, { key: 'ArrowRight' }); expect(dialog.style.transform).toBe('translate(130px, 16px)');
  fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true }); expect(dialog.style.transform).toBe('translate(130px, 17px)');
  fireEvent.keyDown(handle, { key: 'ArrowRight', isComposing: true }); expect(dialog.style.transform).toBe('translate(130px, 17px)');
  fireEvent.keyDown(input, { key: 'ArrowRight' }); expect(dialog.style.transform).toBe('translate(130px, 17px)');
  cleanup(); expect(disconnect).toHaveBeenCalledTimes(1);
});
