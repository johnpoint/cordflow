import type { PortDirection } from '../generated/graph';

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  right: number;
  top: number;
  height: number;
}

export function computePortAnchor(
  portRect: RectLike,
  canvasRect: Pick<RectLike, 'left' | 'top'>,
  direction: PortDirection,
): Point {
  return {
    x: (direction === 'output' ? portRect.right : portRect.left) - canvasRect.left,
    y: portRect.top + portRect.height / 2 - canvasRect.top,
  };
}

export function linkPath(from: Point, to: Point): string {
  const middleX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} C ${middleX} ${from.y}, ${middleX} ${to.y}, ${to.x} ${to.y}`;
}
