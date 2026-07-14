import { useEffect, useRef, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type { Activity, Id } from '../../domain/models';

export interface DialProps {
  activities: readonly Activity[];
  selectedId: Id | null;
  onSelect: (activityId: Id) => void;
  onActivate: (activityId: Id) => void;
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export function Dial({ activities, selectedId, onSelect, onActivate }: DialProps): JSX.Element {
  const dragging = useRef(false);
  const wheelGestureActive = useRef(false);
  const wheelGestureEnd = useRef<number | null>(null);
  const selectedIndex = Math.max(0, activities.findIndex((activity) => activity.id === selectedId));
  const selected = activities[selectedIndex];

  useEffect(() => () => {
    if (wheelGestureEnd.current !== null) window.clearTimeout(wheelGestureEnd.current);
  }, []);

  const selectIndex = (index: number) => {
    const activity = activities[wrapIndex(index, activities.length)];
    if (activity !== undefined) onSelect(activity.id);
  };

  const selectFromPoint = (element: HTMLElement, clientX: number, clientY: number) => {
    if (activities.length === 0) return;
    const bounds = element.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const angleFromTop = Math.atan2(clientY - centerY, clientX - centerX) + Math.PI / 2;
    const normalizedAngle = (angleFromTop + Math.PI * 2) % (Math.PI * 2);
    selectIndex(Math.round(normalizedAngle / ((Math.PI * 2) / activities.length)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextIndex: number | undefined;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = selectedIndex + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = selectedIndex - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = activities.length - 1;

    if (nextIndex !== undefined) {
      event.preventDefault();
      selectIndex(nextIndex);
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && selected !== undefined) {
      event.preventDefault();
      onActivate(selected.id);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const direction = Math.sign(event.deltaY || event.deltaX);
    if (direction === 0) return;
    event.preventDefault();

    if (wheelGestureEnd.current !== null) window.clearTimeout(wheelGestureEnd.current);
    wheelGestureEnd.current = window.setTimeout(() => {
      wheelGestureActive.current = false;
      wheelGestureEnd.current = null;
    }, 180);
    if (wheelGestureActive.current) return;

    wheelGestureActive.current = true;
    selectIndex(selectedIndex + direction);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    selectFromPoint(event.currentTarget, event.clientX, event.clientY);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    selectFromPoint(event.currentTarget, event.clientX, event.clientY);
  };

  const stopDragging = () => {
    dragging.current = false;
  };

  return (
    <div className="dial">
      <div
        className="dial__selector"
        role="listbox"
        aria-label="Activity dial"
        aria-activedescendant={selected === undefined ? undefined : `dial-option-${selected.id}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        {activities.map((activity, index) => {
          const angle = (index / activities.length) * Math.PI * 2 - Math.PI / 2;
          const style = {
            '--activity-color': activity.color,
            left: `${50 + Math.cos(angle) * 39}%`,
            top: `${50 + Math.sin(angle) * 39}%`,
          } as CSSProperties;

          return (
            <button
              className="dial__option"
              id={`dial-option-${activity.id}`}
              type="button"
              role="option"
              aria-selected={activity.id === selected?.id}
              tabIndex={-1}
              style={style}
              key={activity.id}
              onClick={() => onSelect(activity.id)}
            >
              <span className="dial__swatch" aria-hidden="true" />
              <span className="dial__activity-name">{activity.name}</span>
            </button>
          );
        })}
      </div>

      <button
        className="dial__start"
        type="button"
        disabled={selected === undefined}
        onClick={() => selected !== undefined && onActivate(selected.id)}
      >
        {selected === undefined ? 'Choose an activity' : `Start ${selected.name}`}
      </button>
    </div>
  );
}
