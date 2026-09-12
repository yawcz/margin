export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });
  const body = await response
    .json()
    .catch(() => ({ error: 'The server returned an unreadable response.' }));
  if (!response.ok) throw new Error(body.error || 'Something went wrong.');
  return body as T;
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
