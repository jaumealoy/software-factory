import { DomainError, ValidationError } from "../domain/errors.js";
import type { OpenSpecIssue } from "./types.js";

export class OpenSpecConfigurationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "OpenSpecConfigurationError";
  }
}

export class OpenSpecCommandError extends DomainError {
  constructor(
    readonly command: string,
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "OpenSpecCommandError";
  }
}

export class OpenSpecValidationFailedError extends DomainError {
  constructor(
    readonly issues: OpenSpecIssue[],
    message: string,
  ) {
    super(message);
    this.name = "OpenSpecValidationFailedError";
  }
}
