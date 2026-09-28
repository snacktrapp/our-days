import "server-only";

export class FoundBudgetError extends Error {
  readonly statusCode = 402;

  constructor() {
    super("Found is resting for today.");
    this.name = "FoundBudgetError";
  }
}
