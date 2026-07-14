import { act, render, screen } from '@testing-library/react';
import { OfflineStatus } from './OfflineStatus';

it('updates one persistent polite status region only while the browser is offline', () => {
  let online = true;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);

  render(<OfflineStatus />);

  const status = screen.getByRole('status');
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toBeEmptyDOMElement();
  expect(screen.queryByText('Offline — changes stay on this device')).not.toBeInTheDocument();

  act(() => {
    online = false;
    window.dispatchEvent(new Event('offline'));
  });

  expect(screen.getByRole('status')).toBe(status);
  expect(status).toHaveTextContent('Offline — changes stay on this device');

  act(() => {
    online = true;
    window.dispatchEvent(new Event('online'));
  });

  expect(screen.getByRole('status')).toBe(status);
  expect(status).toBeEmptyDOMElement();
  expect(screen.queryByText('Offline — changes stay on this device')).not.toBeInTheDocument();
});
