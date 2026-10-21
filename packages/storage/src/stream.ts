export function closeBody<T>(body: ReadableStream<T>, close: () => void): ReadableStream<T> {
  const reader = body.getReader();
  let closed = false;
  function finish(): void {
    if (!closed) {
      closed = true;
      reader.releaseLock();
      close();
    }
  }
  return new ReadableStream<T>(
    {
      async pull(controller) {
        try {
          const result = await reader.read();
          if (closed) return;
          if (result.done) {
            controller.close();
            finish();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          controller.error(error);
          finish();
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    },
    { highWaterMark: 0 },
  );
}
