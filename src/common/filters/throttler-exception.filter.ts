import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

/**
 * Custom exception filter for throttler exceptions
 * Adds Retry-After header to 429 responses
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as any;

    // Calculate retry-after in seconds (default to 60 if not available)
    const retryAfter = Math.ceil((exceptionResponse.ttl || 60000) / 1000);

    response
      .status(status)
      .header('Retry-After', retryAfter.toString())
      .json({
        statusCode: status,
        message: exceptionResponse.message || 'Too Many Requests',
        error: 'ThrottlerException',
        retryAfter: `${retryAfter}s`,
      });
  }
}
