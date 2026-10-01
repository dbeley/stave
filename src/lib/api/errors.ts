import { SUBSONIC_ERROR } from './endpoints';

/** Base class for every error this app throws from the API layer. */
export class SubsonicError extends Error {
  override readonly name: string = 'SubsonicError';

  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** Wrong username/password/token — the UI asks the user to re-authenticate. */
export class AuthError extends SubsonicError {
  override readonly name = 'AuthError';

  constructor(message = 'Authentication failed') {
    super(message, SUBSONIC_ERROR.WRONG_CREDENTIALS);
  }
}

/** The server answered, but not with something we can use. */
export class ProtocolError extends SubsonicError {
  override readonly name = 'ProtocolError';
}

/** The request never completed (offline, DNS, timeout, CORS). */
export class NetworkError extends SubsonicError {
  override readonly name: string = 'NetworkError';

  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class RequestTimeoutError extends NetworkError {
  override readonly name: string = 'RequestTimeoutError';
}

export function isAuthError(error: unknown): error is AuthError {
  if (error instanceof AuthError) return true;
  return (
    error instanceof SubsonicError &&
    (error.code === SUBSONIC_ERROR.WRONG_CREDENTIALS ||
      error.code === SUBSONIC_ERROR.TOKEN_AUTH_NOT_SUPPORTED)
  );
}

export function describeError(error: unknown): string {
  if (error instanceof SubsonicError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
