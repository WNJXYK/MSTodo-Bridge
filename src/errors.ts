/** Base error carrying a user-actionable message. */
export class TaskBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskBridgeError';
  }
}

/** Credentials missing or refresh failed — user must run the auth flow. */
export class AuthError extends TaskBridgeError {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly authCommand?: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Provider API can't do what was asked (capability gap). */
export class UnsupportedError extends TaskBridgeError {}

/** Upstream HTTP/API failure with context preserved. */
export class ApiError extends TaskBridgeError {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toMcpError(err: unknown): { code: string; message: string } {
  if (err instanceof AuthError) {
    return {
      code: 'auth_required',
      message: `[${err.providerId}] ${err.message} 请调用 start_login 工具开始登录流程。`,
    };
  }
  if (err instanceof UnsupportedError) {
    return { code: 'unsupported', message: err.message };
  }
  if (err instanceof ApiError) {
    return { code: 'provider_error', message: err.message };
  }
  if (err instanceof Error) {
    return { code: 'internal', message: err.message };
  }
  return { code: 'internal', message: String(err) };
}
