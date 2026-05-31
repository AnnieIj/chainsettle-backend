import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditLogService } from './audit-log.service';

/**
 * AuditLogInterceptor
 *
 * Automatically records all successful POST, PATCH, DELETE mutations.
 * Skips GET requests (read-only operations don't need auditing).
 *
 * Extracts actor information from the request, derives action/resource
 * from the route, and passes to AuditLogService for recording.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly auditLog: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const method = request.method;
    const path = request.path;
    const user = request.user; // Set by JwtAuthGuard

    // Skip GET requests (read-only operations)
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    // Extract actor information
    const actorId = user?.id;
    const actorAddress = user?.stellarAddress ?? 'SYSTEM';

    // Derive action and resource from route
    const { action, resourceType, resourceId } = this.deriveActionAndResource(
      method,
      path,
      request,
    );

    return next.handle().pipe(
      tap((response) => {
        // Only record on successful responses (2xx status)
        const statusCode = context.switchToHttp().getResponse().statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          this.auditLog.record({
            actorId,
            actorAddress,
            action,
            resourceType,
            resourceId,
            metadata: {
              method,
              path,
              statusCode,
              // Optionally include request body/params for context
              ...(request.body && { requestBody: this.sanitizeBody(request.body) }),
            },
            ipAddress: this.getClientIp(request),
          });
        }
      }),
      catchError((error) => {
        // Don't record failed operations (unless specifically needed)
        throw error;
      }),
    );
  }

  /**
   * Extract action, resourceType, and resourceId from the HTTP method and path.
   * Examples:
   *   POST /shipments → { action: 'shipment.create', resourceType: 'Shipment', resourceId: 'generated-id' }
   *   PATCH /shipments/SHIP-001 → { action: 'shipment.update', resourceType: 'Shipment', resourceId: 'SHIP-001' }
   *   DELETE /milestones/1 → { action: 'milestone.delete', resourceType: 'Milestone', resourceId: '1' }
   */
  private deriveActionAndResource(
    method: string,
    path: string,
    request: any,
  ): { action: string; resourceType: string; resourceId: string } {
    const segments = path.split('/').filter(s => s.length > 0);

    // Extract resource type (usually first segment after /api/v1)
    // Format: /api/v1/{resourceType}/{resourceId}/{subresource}
    let resourceType = 'Unknown';
    let resourceId = 'unknown-id';
    let subAction = '';

    if (segments.length >= 2) {
      resourceType = segments[1]; // e.g., 'shipments', 'milestones'
      resourceType = resourceType.charAt(0).toUpperCase() + resourceType.slice(1, -1); // Singularize: shipments → Shipment
    }

    if (segments.length >= 3) {
      resourceId = segments[2];

      // Check for sub-resources (e.g., /shipments/:id/sync)
      if (segments.length >= 4) {
        subAction = segments[3]; // e.g., 'sync', 'proof'
      }
    }

    // Determine action
    let action = `${resourceType.toLowerCase()}.create`;
    if (method === 'PATCH') {
      action = `${resourceType.toLowerCase()}.update`;
    } else if (method === 'DELETE') {
      action = `${resourceType.toLowerCase()}.delete`;
    } else if (method === 'POST' && subAction) {
      action = `${resourceType.toLowerCase()}.${subAction}`;
    }

    return { action, resourceType, resourceId };
  }

  /**
   * Sanitize request body to avoid logging sensitive data.
   */
  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return body;

    const sanitized = { ...body };

    // Remove sensitive fields
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'privateKey',
      'seed',
      'mnemonic',
    ];

    sensitiveFields.forEach((field) => {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Extract client IP address from request.
   */
  private getClientIp(request: any): string | undefined {
    return (
      request.headers['x-forwarded-for']?.split(',')[0] ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      undefined
    );
  }
}
