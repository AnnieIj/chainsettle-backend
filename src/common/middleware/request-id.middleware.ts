import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export const requestIdStorage = new AsyncLocalStorage<string>();

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string) || randomUUID();

    (req as any).id = requestId;
    res.setHeader('X-Request-ID', requestId);

    requestIdStorage.run(requestId, () => next());
  }
}