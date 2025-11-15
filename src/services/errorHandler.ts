import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, isOperationalError } from '../errors/customErrors';

export class ErrorHandler {
  async handleError(error: Error, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    let statusCode = 500;
    let message = 'Internal server error';
    if (error instanceof AppError) {
      statusCode = error.statusCode;
      message = error.message;
    }
    reply.code(statusCode).send({ error: { message, statusCode } });
  }

  handleWebSocketError(error: Error, ws: any, orderId?: string): void {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        error: true,
        message: error.message,
        orderId,
        timestamp: Date.now(),
      }));
    }
  }

  handleUnhandledRejection(reason: any, promise: Promise<any>): void {
    console.error('🚨 Unhandled Rejection:', reason);
    if (!isOperationalError(reason)) process.exit(1);
  }

  handleUncaughtException(error: Error): void {
    console.error('🚨 Uncaught Exception:', error);
    process.exit(1);
  }
}

export const errorHandler = new ErrorHandler();
