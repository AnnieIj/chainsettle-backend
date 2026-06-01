import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FindAllEventsDto } from './dto/find-all-events.dto';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'List on-chain events with optional shipment, ledger range, and topic filters' })
  findAll(@Query() query: FindAllEventsDto) {
    // Validate boundaries: startLedger must be less than or equal to endLedger
    if (query.startLedger && query.endLedger && query.startLedger > query.endLedger) {
      throw new BadRequestException('startLedger sequence boundary cannot be greater than endLedger sequence boundary');
    }

    // Forward the unified query object to the service layer for processing
    return this.eventsService.findAll(query);
  }

  // ----------------------------------------------------------
  // ADMIN — Dead-letter queue management
  // ----------------------------------------------------------

  @Get('admin/failed-events')
  @ApiOperation({ summary: '[Admin] List unresolved failed events (DLQ)' })
  getFailedEvents(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    this.requireAdmin(user);
    return this.eventsService.getAdminFailedEvents(page, limit);
  }

  @Post('admin/failed-events/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Manually retry a failed event by ID' })
  async retryFailedEvent(@Param('id') id: string, @CurrentUser() user: any) {
    this.requireAdmin(user);
    try {
      await this.eventsService.retryFailedEventById(id);
      return { message: `Failed event ${id} retried and resolved successfully` };
    } catch (error) {
      if ((error as any).code === 'P2025') {
        throw new NotFoundException(`Failed event ${id} not found`);
      }
      throw error;
    }
  }

  private requireAdmin(user: any) {
    if (user?.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
  }
}