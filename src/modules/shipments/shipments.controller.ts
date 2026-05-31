import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto, UpdateShipmentDto } from './dto/create-shipment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShipmentParticipantGuard } from './guards/shipment-participant.guard';
import { ShipmentStatus, UserRole } from '@prisma/client';


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
   * 
   * If templateId is provided, fields are pre-populated from the template.
   * Explicit fields in the request override template values.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a newly created on-chain shipment' })
  @ApiResponse({ status: 201, description: 'Shipment registered successfully' })
  create(@Body() dto: CreateShipmentDto, @CurrentUser() user: any) {
    // POST /shipments remains open to any authenticated user,
    // but buyerAddress must match the authenticated caller.
    if (user?.role !== UserRole.ADMIN && dto.buyerAddress !== user?.stellarAddress) {
      throw new ForbiddenException('buyerAddress must match the authenticated user');
    }

    return this.shipmentsService.create(dto);
  }


  /**
   * GET /api/v1/shipments
   * List shipments with optional filters. Users see only their own shipments.
   */
  @Get()
  @ApiOperation({ summary: 'List shipments with filters and pagination' })
  @ApiQuery({ name: 'buyerAddress', required: false })
  @ApiQuery({ name: 'supplierAddress', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ShipmentStatus })
  @ApiQuery({ name: 'referenceNumber', required: false })
  @ApiQuery({ name: 'tags', required: false, description: 'Comma-separated tags' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentUser() user: any,
    @Query('buyerAddress') buyerAddress?: string,
    @Query('supplierAddress') supplierAddress?: string,
    @Query('status') status?: ShipmentStatus,
    @Query('referenceNumber') referenceNumber?: string,
    @Query('tags') tagsQuery?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    // Ignore buyerAddress/supplierAddress filters for non-admin callers
    // to prevent listing other users' shipments.
    const isAdmin = user?.role === UserRole.ADMIN;
    const tags = tagsQuery ? tagsQuery.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

    return this.shipmentsService.findAll({
      buyerAddress: isAdmin ? buyerAddress : undefined,
      supplierAddress: isAdmin ? supplierAddress : undefined,
      status,
      referenceNumber,
      tags,
      page,
      limit,
      callerStellarAddress: user?.stellarAddress,
      isAdmin,
    });
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
   * Only the buyer can update. Financial fields are immutable.
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
   * Designated arbiter accepts their assignment. Sets arbiterStatus to ACCEPTED
   * and notifies the buyer.
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
   * Designated arbiter declines their assignment. Sets arbiterStatus to DECLINED
   * and notifies the buyer.
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
   * Manually trigger a sync of the shipment state from the Stellar chain.
   */
  @Post(':id/sync')
  @UseGuards(ShipmentParticipantGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force sync shipment status from Stellar chain' })
  sync(@Param('id') id: string) {
    return this.shipmentsService.syncStatusFromChain(id);
  }

}
