import type { Point } from '../domain/types';

/** Touch taps use CSS coordinates. A drag or a second pointer invalidates the entire pair. */
export class DoubleTapRecognizer {
  private pressed: { pointerId: number; point: Point; at: number; context: string } | null = null;
  private previous: { point: Point; at: number; context: string } | null = null;
  down(pointerId: number, point: Point, at: number, context: string): void {
    if (this.pressed) { this.cancel(); return; }
    this.pressed = { pointerId, point: { ...point }, at, context };
  }
  move(pointerId: number, point: Point): void {
    if (this.pressed?.pointerId === pointerId && Math.hypot(point.x - this.pressed.point.x, point.y - this.pressed.point.y) >= 3) this.cancel();
  }
  up(pointerId: number, point: Point, at: number): boolean {
    const pressed = this.pressed;
    if (!pressed || pressed.pointerId !== pointerId) return false;
    this.pressed = null;
    if (at < pressed.at || at - pressed.at > 300 || Math.hypot(point.x - pressed.point.x, point.y - pressed.point.y) >= 3) { this.previous = null; return false; }
    const previous = this.previous;
    if (previous && previous.context === pressed.context && at >= previous.at && at - previous.at <= 300 && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= 12) {
      this.previous = null; return true;
    }
    this.previous = { point: { ...point }, at, context: pressed.context }; return false;
  }
  cancel(): void { this.pressed = null; this.previous = null; }
}
