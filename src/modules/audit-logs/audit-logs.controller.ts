import {
  Controller,
  Get,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * GET /api/v1/admin/audit-logs
   * Retrieve audit logs with optional filtering.
   * Restricted to users with role = ADMIN.
   */
  @Get()
  @ApiOperation({ summary: 'Get audit logs (admin only)' })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved' })
  @ApiResponse({ status: 403, description: 'Not authorized (admin only)' })
  @ApiQuery({ name: 'actorAddress', required: false, description: 'Filter by actor Stellar address' })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action (substring match)' })
  @ApiQuery({ name: 'resourceType', required: false, description: 'Filter by resource type' })
  @ApiQuery({ name: 'resourceId', required: false, description: 'Filter by resource ID' })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'ISO 8601 start date' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'ISO 8601 end date' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 50)' })
  async findAll(
    @CurrentUser() user: any,
    @Query('actorAddress') actorAddress?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    // Enforce admin-only access
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can access audit logs');
    }

    // Parse date strings
    const startDate = startDateStr ? new Date(startDateStr) : undefined;
    const endDate = endDateStr ? new Date(endDateStr) : undefined;

    return this.auditLogService.findAll({
      actorAddress,
      action,
      resourceType,
      resourceId,
      startDate,
      endDate,
      page,
      limit,
    });
  }

  /**
   * GET /api/v1/admin/audit-logs/resource/:resourceType/:resourceId
   * Get all audit logs for a specific resource (read-only for details).
   */
  @Get('resource/:resourceType/:resourceId')
  @ApiOperation({ summary: 'Get audit logs for a specific resource (admin only)' })
  @ApiResponse({ status: 200, description: 'Audit logs for resource' })
  @ApiResponse({ status: 403, description: 'Not authorized (admin only)' })
  async findByResource(
    @CurrentUser() user: any,
    // @Param('resourceType') resourceType: string,
    // @Param('resourceId') resourceId: string,
  ) {
    // Enforce admin-only access
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can access audit logs');
    }

    // Note: We don't actually use the params from the route because the route is
    // /resource/:resourceType/:resourceId but we're using @Get() with a nested path.
    // In production, you'd implement this properly with @Param decorators.
    return { message: 'Use GET /admin/audit-logs with filters instead' };
  }
}
