export class PublicError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function joinError(error) {
  if (error?.code === "23505") return new PublicError("DUPLICATE_NICKNAME");
  if (error?.code === "P0001" && error.message === "Game is full")
    return new PublicError("SESSION_FULL");
  if (error?.code === "P0001") return new PublicError("SESSION_CLOSED");
  if (error?.code === "22023") return new PublicError("INVALID_INPUT");
  return new PublicError("SERVER_ERROR");
}
