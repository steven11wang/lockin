import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { DEFAULT_ACTIVITIES } from '../../domain/defaults';
import type { Activity } from '../../domain/models';
import { Dial } from './Dial';

const activities = DEFAULT_ACTIVITIES.slice(0, 4);

interface DialHarnessProps {
  initialId?: string;
  items?: readonly Activity[];
  isActive?: boolean;
  onActivate?: (activityId: string) => void;
  onStop?: () => void;
}

function DialHarness({
  initialId = activities[0]?.id ?? '',
  items = activities,
  isActive = false,
  onActivate = () => undefined,
  onStop = () => undefined,
}: DialHarnessProps) {
  const [selectedId, setSelectedId] = useState(initialId);

  return (
    <Dial
      activities={items}
      selectedId={selectedId}
      isActive={isActive}
      onSelect={setSelectedId}
      onActivate={onActivate}
      onStop={onStop}
    />
  );
}

function selectedActivityName(): string | null {
  return screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')
    ?.textContent ?? null;
}

describe('Dial', () => {
  it('wraps selection with ArrowRight and ArrowLeft', () => {
    render(<DialHarness />);
    const dial = screen.getByRole('listbox', { name: 'Activity dial' });

    fireEvent.keyDown(dial, { key: 'ArrowLeft' });
    expect(selectedActivityName()).toBe('Social');

    fireEvent.keyDown(dial, { key: 'ArrowRight' });
    expect(selectedActivityName()).toBe('Study');
  });

  it('selects the first and last activities with Home and End', () => {
    render(<DialHarness initialId="activity-exercise" />);
    const dial = screen.getByRole('listbox', { name: 'Activity dial' });

    fireEvent.keyDown(dial, { key: 'End' });
    expect(selectedActivityName()).toBe('Social');

    fireEvent.keyDown(dial, { key: 'Home' });
    expect(selectedActivityName()).toBe('Study');
  });

  it('activates the selected activity with Enter and Space', () => {
    const onActivate = vi.fn();
    render(<DialHarness initialId="activity-work" onActivate={onActivate} />);
    const dial = screen.getByRole('listbox', { name: 'Activity dial' });

    fireEvent.keyDown(dial, { key: 'Enter' });
    fireEvent.keyDown(dial, { key: ' ' });

    expect(onActivate).toHaveBeenNthCalledWith(1, 'activity-work');
    expect(onActivate).toHaveBeenNthCalledWith(2, 'activity-work');
  });

  it('moves only one activity per wheel gesture regardless of event count or delta size', () => {
    vi.useFakeTimers();
    render(<DialHarness />);
    const dial = screen.getByRole('listbox', { name: 'Activity dial' });

    fireEvent.wheel(dial, { deltaY: 10_000 });
    fireEvent.wheel(dial, { deltaY: 10_000 });

    expect(selectedActivityName()).toBe('Exercise');

    vi.advanceTimersByTime(250);
    fireEvent.wheel(dial, { deltaY: 10_000 });
    expect(selectedActivityName()).toBe('Work');
    vi.useRealTimers();
  });

  it('selects the nearest activity while dragging around the dial', () => {
    render(<DialHarness />);
    const dial = screen.getByRole('listbox', { name: 'Activity dial' });
    vi.spyOn(dial, 'getBoundingClientRect').mockReturnValue({
      bottom: 300,
      height: 200,
      left: 100,
      right: 300,
      top: 100,
      width: 200,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(dial, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(dial, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(dial, { pointerId: 1 });

    expect(selectedActivityName()).toBe('Exercise');
  });

  it('keeps every activity name exposed as text and in the accessibility tree', () => {
    render(<DialHarness />);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Study',
      'Exercise',
      'Work',
      'Social',
    ]);
    expect(screen.getByRole('button', { name: 'Start Study' })).toBeVisible();
  });

  it('shows Start activity before a session and a single red Stop control while active', () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <Dial
        activities={activities}
        selectedId="activity-study"
        isActive={false}
        onSelect={() => undefined}
        onActivate={() => undefined}
        onStop={onStop}
      />,
    );

    expect(screen.getByRole('button', { name: 'Start Study' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();

    rerender(
      <Dial
        activities={activities}
        selectedId="activity-exercise"
        isActive
        onSelect={() => undefined}
        onActivate={() => undefined}
        onStop={onStop}
      />,
    );

    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toBeVisible();
    expect(stop).toHaveClass('dial__start--stop');
    expect(screen.queryByRole('button', { name: /Start / })).not.toBeInTheDocument();

    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('switches by tapping another dial option while a session is active', () => {
    const onActivate = vi.fn();
    const onSelect = vi.fn();
    render(
      <Dial
        activities={activities}
        selectedId="activity-study"
        isActive
        onSelect={onSelect}
        onActivate={onActivate}
        onStop={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('option', { name: 'Exercise' }));
    expect(onSelect).toHaveBeenCalledWith('activity-exercise');
    expect(onActivate).toHaveBeenCalledWith('activity-exercise');
  });
});
