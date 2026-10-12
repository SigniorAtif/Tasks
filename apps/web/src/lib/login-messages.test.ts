import { describe, expect, it } from 'vitest';
import { callbackErrorMessage, signInErrorMessage } from './login-messages.ts';

describe('callbackErrorMessage', () => {
  it.each(['not_invited', 'unable_to_create_user', 'NOT_INVITED'])(
    'says the account is not allowed for %s, without the raw code',
    (code) => {
      expect(callbackErrorMessage(code)).toEqual({
        text: "This Google account isn't allowed to sign in.",
      });
    },
  );

  it('shows any other code generically, with the code for the small print', () => {
    expect(callbackErrorMessage('access_denied')).toEqual({
      text: "Sign-in didn't finish. Please try again.",
      code: 'access_denied',
    });
  });
});

describe('signInErrorMessage', () => {
  it('explains a server without Google configured', () => {
    const message = signInErrorMessage({
      status: 404,
      code: 'PROVIDER_NOT_FOUND',
      message: 'Provider not found',
    });
    expect(message.text).toBe("Google sign-in isn't set up on this server yet.");
  });

  it('calls a missing answer a connection problem', () => {
    expect(signInErrorMessage(null).text).toMatch(/Couldn't reach the server/);
  });

  it('falls back to the HTTP status when there is no code', () => {
    expect(signInErrorMessage({ status: 500 })).toEqual({
      text: "Couldn't start Google sign-in. Please try again.",
      code: 'HTTP 500',
    });
  });
});
