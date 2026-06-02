import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto, UpdateShipmentDto } from './dto/create-shipment.dto';
import { FindAllShipmentsDto } from './dto/find-all-shipments.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShipmentParticipantGuard } from './guards/shipment-participant.guard';
import { UserRole } from '@prisma/client';

@ApiTags('shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) { }

  /**
   * POST /api/v1/shipments
   * Called by the frontend after the buyer has signed and broadcast
   * the create_shipment transaction via Freighter. The backend stores
   * the off-chain metadata and links it to the on-chain shipment.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a newly created on-chain shipment' })
  @ApiResponse({ status: 201, description: 'Shipment registered successfully' })
  create(@Body() dto: CreateShipmentDto, @CurrentUser() user: any) {
    if (user?.role !== UserRole.ADMIN && dto.buyerAddress !== user?.stellarAddress) {
      throw new ForbiddenException('buyerAddress must match the authenticated user');
    }

    return this.shipmentsService.create(dto);
  }

  /**
   * GET /api/v1/shipments
   * List shipments with optional filters and date ranges. Users see only their own shipments.
   */
  @Get()
  @ApiOperation({ summary: 'List shipments with chronological filters and pagination' })
  @ApiResponse({ status: 200, description: 'Filtered list of shipments' })
  findAll(@CurrentUser() user: any, @Query() query: FindAllShipmentsDto) {
    // 1. Cross-field Date Validations
    if (query.createdAfter && query.createdBefore && new Date(query.createdAfter) > new Date(query.createdBefore)) {
      throw new BadRequestException('createdAfter date cannot be further in the future than createdBefore date');
    }

    if (query.updatedAfter && query.updatedBefore && new Date(query.updatedAfter) > new Date(query.updatedBefore)) {
      throw new BadRequestException('updatedAfter date cannot be further in the future than updatedBefore date');
    }

    // 2. Evaluate administrative scope constraints
    const isAdmin = user?.role === UserRole.ADMIN;
    
    // Parse tag array structures safely from string formats
    const tags = query.tags ? query.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

    // 3. Delegate execution context payload down to service layers
    return this.shipmentsService.findAll({
      buyerAddress: isAdmin ? query.buyerAddress : undefined,
      supplierAddress: isAdmin ? query.supplierAddress : undefined,
      status: query.status,
      referenceNumber: query.referenceNumber,
      tags,
      page: query.page,
      limit: query.limit,
      createdAfter: query.createdAfter,
      createdBefore: query.createdBefore,
      updatedAfter: query.updatedAfter,
      updatedBefore: query.updatedBefore,
      callerStellarAddress: user?.stellarAddress,
      isAdmin,
    });
  }

  /**
   * GET /api/v1/shipments/export?format=csv|pdf
   * Export all shipments visible to the caller.
   * Rate-limited to 5 requests per hour per user.
   */
  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @ApiOperation({ summary: 'Export shipments as CSV or PDF' })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'pdf'], description: 'csv (default) or pdf' })
  async export(
    @CurrentUser() user: any,
    @Query('format') format: string = 'csv',
    @Res() res: Response,
  ) {
    if (!['csv', 'pdf'].includes(format)) {
      throw new BadRequestException('format must be csv or pdf');
    }

    const isAdmin = user?.role === UserRole.ADMIN;
    const shipments = await this.shipmentsService.exportForUser(user.stellarAddress, isAdmin);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'pdf') {
      const pdf = await this.shipmentsService.buildPdf(shipments);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="chainsettle-export-${timestamp}.pdf"`);
      res.end(pdf);
    } else {
      const csv = this.shipmentsService.buildCsv(shipments);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="chainsettle-export-${timestamp}.csv"`);
      res.end(csv);
    }
  }


  /**
   * GET /api/v1/shipments/:id
   * Full shipment detail including milestones and recent on-chain events.
   */
  @Get(':id')
  @UseGuards(ShipmentParticipantGuard)
  @ApiOperation({ summary: 'Get full shipment details including milestones and events' })
  @ApiResponse({ status: 200, description: 'Shipment found' })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  findOne(@Param('id') id: string) {
    return this.shipmentsService.findOne(id);
  }

  /**
   * PATCH /api/v1/shipments/:id
   * Update shipment metadata (description, referenceNumber, metadata, tags).
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update shipment metadata (description, reference, metadata, tags)' })
  @ApiResponse({ status: 200, description: 'Shipment updated successfully' })
  @ApiResponse({ status: 403, description: 'Only buyer can update' })
  @ApiResponse({ status: 409, description: 'Reference number already in use' })
  update(@Param('id') id: string, @Body() dto: UpdateShipmentDto, @CurrentUser() user: any) {
    return this.shipmentsService.update(id, user.stellarAddress, dto);
  }

  /**
   * POST /api/v1/shipments/:id/arbiter/accept
   */
  @Post(':id/arbiter/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept arbiter assignment for a shipment' })
  @ApiResponse({ status: 200, description: 'Arbiter assignment accepted' })
  @ApiResponse({ status: 403, description: 'Only the designated arbiter can accept' })
  @ApiResponse({ status: 409, description: 'Assignment already resolved' })
  arbiterAccept(@Param('id') id: string, @CurrentUser() user: any) {
    return this.shipmentsService.arbiterAccept(id, user.stellarAddress);
  }

  /**
   * POST /api/v1/shipments/:id/arbiter/decline
   */
  @Post(':id/arbiter/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline arbiter assignment for a shipment' })
  @ApiResponse({ status: 200, description: 'Arbiter assignment declined' })
  @ApiResponse({ status: 403, description: 'Only the designated arbiter can decline' })
  @ApiResponse({ status: 409, description: 'Assignment already resolved' })
  arbiterDecline(@Param('id') id: string, @CurrentUser() user: any) {
    return this.shipmentsService.arbiterDecline(id, user.stellarAddress);
  }

  /**
   * POST /api/v1/shipments/:id/sync
   */
  @Post(':id/sync')
  @UseGuards(ShipmentParticipantGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force sync shipment status from Stellar chain' })
  sync(@Param('id') id: string) {
    return this.shipmentsService.syncStatusFromChain(id);
  }
}