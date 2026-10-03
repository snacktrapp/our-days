import "server-only";

export class FoundBudgetError extends Error {
  readonly statusCode = 402;

  constructor() {
    super("Found is resting for today.");
    this.name = "FoundBudgetError";
  }
}

export class FoundUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super("Found is unavailable.");
    this.name = "FoundUnavailableError";
  }
}
