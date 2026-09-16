// Bound complete responses, including body consumption (not only receipt of headers).
const readBounded = async (response, maxBytes = 2000000, signal) => {
  const length = Number(response.headers?.get?.('content-length'));
  if (length > maxBytes) {
    await response.body?.cancel?.();
    response.body?.destroy?.();
    throw new Error('Source response too large');
  }
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader?.();
  const cancel = () => { if (reader) void reader.cancel().catch(() => {}); else response.body?.destroy?.(); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('Source response too large');
        chunks.push(Buffer.from(value));
      }
    } else if (response.body?.[Symbol.asyncIterator]) {
      for await (const chunk of response.body) {
        signal?.throwIfAborted();
        size += chunk.length;
        if (size > maxBytes) throw new Error('Source response too large');
        chunks.push(Buffer.from(chunk));
      }
    } else {
      const text = await response.text();
      if (Buffer.byteLength(text) > maxBytes) throw new Error('Source response too large');
      chunks.push(Buffer.from(text));
    }
    return Buffer.concat(chunks);
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
};
const createEvidenceFetcher = (fetchWithTimeout) => async (url, { fetchOptions = {}, maxBytes = 2000000, range, timeoutMs = 10000 } = {}) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  fetchOptions.signal?.addEventListener('abort', abort, { once: true });
  if (fetchOptions.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchWithTimeout(url, { ...fetchOptions, signal: controller.signal, headers: { ...fetchOptions.headers, ...(range ? { Range: range } : {}) } }, timeoutMs);
    if (!response.ok || (range && response.status !== 206)) {
      await response.body?.cancel?.();
      response.body?.destroy?.();
      throw new Error(`Source HTTP ${response.status}`);
    }
    const data = await readBounded(response, maxBytes, controller.signal);
    if (range) {
      const expected = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!expected || data.length !== Number(expected[2]) - Number(expected[1]) + 1 || !response.headers.get('content-range')?.startsWith(`bytes ${expected[1]}-${expected[2]}/`)) throw new Error('Invalid source byte range');
    }
    return data;
  } finally {
    clearTimeout(timer);
    fetchOptions.signal?.removeEventListener('abort', abort);
  }
};
module.exports = { createEvidenceFetcher, readBounded };
