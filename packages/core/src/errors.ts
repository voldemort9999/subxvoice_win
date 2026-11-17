export type ErrorCode = "unsupported" | "permission_denied" | "provider";

export class SubxError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "SubxError";
    this.code = code;
  }
}
