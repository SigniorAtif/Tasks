/** One `Set-Cookie` header, split into its name, value and attributes. */
export interface SetCookie {
  name: string;
  value: string;
  /** Lower-cased attribute names → values (`''` for flags such as `httponly`). */
  attributes: Map<string, string>;
}

export function setCookies(response: Response): SetCookie[] {
  return response.headers.getSetCookie().map((header) => {
    const [pair = '', ...parts] = header.split(';').map((part) => part.trim());
    const equals = pair.indexOf('=');
    const attributes = new Map<string, string>();
    for (const part of parts) {
      const [key = '', ...rest] = part.split('=');
      attributes.set(key.toLowerCase(), rest.join('='));
    }
    return { name: pair.slice(0, equals), value: pair.slice(equals + 1), attributes };
  });
}

/** The cookie named `name` that this response sets, if any. */
export function findSetCookie(response: Response, name: string): SetCookie | undefined {
  return setCookies(response).find((cookie) => cookie.name === name);
}

/** What a browser would send back: `a=1; b=2` from every non-empty cookie the response set. */
export function cookieHeader(response: Response): string {
  return setCookies(response)
    .filter((cookie) => cookie.value !== '')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}
