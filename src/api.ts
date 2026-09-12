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
  if (!response.ok) {
    // An expired session should send the reader back to the login form, not leave the UI stale.
    if (response.status === 401 && path !== '/login')
      window.dispatchEvent(new Event('margin:unauthenticated'));
    throw new Error(body.error || 'Something went wrong.');
  }
  return body as T;
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
