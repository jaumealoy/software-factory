export class DomainError extends Error {
  override name = "DomainError";
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
    this.name = "NotFoundError";
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class CyclicDependencyError extends DomainError {
  constructor(taskId: string, dependsOnTaskId: string) {
    super(`Adding dependency ${taskId} -> ${dependsOnTaskId} would create a cycle`);
    this.name = "CyclicDependencyError";
  }
}

export class DuplicateError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConfigurationError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
