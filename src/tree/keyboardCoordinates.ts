import type { KeyboardEvent } from "react";
import type { SensorContext } from "./types";

const directions = {
  Up: -1,
  Down: 1,
  Left: -1,
  Right: 1,
};

export function sortableTreeKeyboardCoordinates(
  context: React.RefObject<SensorContext>,
  indicator: boolean,
  indentationWidth: number
) {
  return (event: KeyboardEvent) => {
    const { items, offset } = context.current;
    const currentIndex = items.findIndex(({ id }) => id === event.currentTarget.id);
    if (currentIndex < 0) {
      return;
    }
    const direction = directions[event.key.replace("Arrow", "") as keyof typeof directions];
    if (!direction) {
      return;
    }

    const nextIndex = currentIndex + direction;
    const over = items[nextIndex];
    if (!over) {
      return;
    }

    const nextOffset = indicator
      ? offset + (event.key === "ArrowRight" ? indentationWidth : 0)
      : offset;

    return {
      x: nextOffset,
      y: direction * 25,
    };
  };
}
