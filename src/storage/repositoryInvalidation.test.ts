import { createRepositoryInvalidationChannel } from './repositoryInvalidation';

function disposeChannel(channel: object): void {
  expect('dispose' in channel).toBe(true);
  if (!('dispose' in channel)) return;
  (channel as { dispose(): void }).dispose();
}

it('unregisters a disposed same-realm channel and stays bounded across repeated creation', () => {
  const writer = createRepositoryInvalidationChannel('disposal-realm', vi.fn());
  const staleListener = vi.fn();

  for (let index = 0; index < 12; index += 1) {
    const temporary = createRepositoryInvalidationChannel('disposal-realm', staleListener);
    disposeChannel(temporary);
  }

  writer.notifyCommittedWrite();

  expect(staleListener).not.toHaveBeenCalled();
  disposeChannel(writer);
});

it('falls back to another entropy source when crypto.randomUUID throws', () => {
  const randomUuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
    throw new Error('randomUUID unavailable');
  });
  const invalidated = vi.fn();
  let writer: ReturnType<typeof createRepositoryInvalidationChannel> | undefined;
  let receiver: ReturnType<typeof createRepositoryInvalidationChannel> | undefined;

  try {
    expect(() => {
      writer = createRepositoryInvalidationChannel('uuid-fallback', vi.fn());
      receiver = createRepositoryInvalidationChannel('uuid-fallback', invalidated);
    }).not.toThrow();
    writer!.notifyCommittedWrite();
    expect(invalidated).toHaveBeenCalledTimes(1);
  } finally {
    writer?.dispose();
    receiver?.dispose();
    randomUuid.mockRestore();
  }
});

it('removes browser listeners and closes BroadcastChannel exactly once', () => {
  const close = vi.fn();
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const postMessage = vi.fn();
  class FakeBroadcastChannel {
    constructor(readonly name: string) {}

    addEventListener = addEventListener;

    removeEventListener = removeEventListener;

    postMessage = postMessage;

    close = close;
  }
  const original = Object.getOwnPropertyDescriptor(window, 'BroadcastChannel');
  Object.defineProperty(window, 'BroadcastChannel', {
    configurable: true,
    value: FakeBroadcastChannel,
  });
  const removeDocumentListener = vi.spyOn(document, 'removeEventListener');

  try {
    const channel = createRepositoryInvalidationChannel('disposal-browser', vi.fn());
    disposeChannel(channel);
    disposeChannel(channel);

    expect(removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    removeDocumentListener.mockRestore();
    if (original === undefined) {
      Reflect.deleteProperty(window, 'BroadcastChannel');
    } else {
      Object.defineProperty(window, 'BroadcastChannel', original);
    }
  }
});
