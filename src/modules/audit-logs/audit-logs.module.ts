import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogInterceptor } from './audit-log.interceptor';

@Module({
  providers: [AuditLogService, AuditLogInterceptor],
  controllers: [AuditLogsController],
  exports: [AuditLogService, AuditLogInterceptor],
})
export class AuditLogsModule {}
