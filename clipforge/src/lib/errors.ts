export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
  }
}

/** Thrown when a required external service has no configuration. Never faked. */
export class SetupRequiredError extends Error {
  constructor(public service: string, public missing: string[]) {
    super(`${service} is not configured (missing: ${missing.join(", ")})`);
    this.name = "SetupRequiredError";
  }
}
