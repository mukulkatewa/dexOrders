export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: Record<string, any>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 400, true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier: string) {
    super(`${resource} with ID ${identifier} not found`, 404, true);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(
      message,
      500,
      true,
      originalError ? { originalError: originalError.message } : undefined
    );
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, statusCode: number = 503) {
    super(`${service} error: ${message}`, statusCode, true, { service });
  }
}

export class OrderExecutionError extends AppError {
  constructor(orderId: string, message: string, context?: Record<string, any>) {
    super(`Order ${orderId} execution failed: ${message}`, 500, true, { orderId, ...context });
  }
}

export function isOperationalError(error: any): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

export function getErrorMessage(error: any): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function getErrorStack(error: any): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}
