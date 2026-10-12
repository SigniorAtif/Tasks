// The browser half of Better Auth. It knows Better Auth's routes (sign-in,
// sign-out) so we don't hand-write those requests. With no `baseURL` it calls
// /api/auth on the page's own origin, which is where the API mounts it.

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();
