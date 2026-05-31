import { 
  Controller, 
  Get, 
  Post,
  Param, 
  ParseIntPipe, 
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiBearerAuth, 
  ApiConsumes,
  ApiResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { MilestonesService } from './milestones.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubmitDisputeEvidenceDto } from './dto/submit-dispute-evidence.dto';

@ApiTags('milestones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipments/:shipmentId/milestones')
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Get()
  @ApiOperation({ summary: 'List all milestones for a shipment' })
  findAll(@Param('shipmentId') shipmentId: string) {
    return this.milestonesService.findByShipment(shipmentId);
  }

  @Get(':index')
  @ApiOperation({ summary: 'Get a single milestone by index' })
  findOne(
    @Param('shipmentId') shipmentId: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.milestonesService.findOne(shipmentId, index);
  }

  @Post(':index/dispute-evidence')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ 
    summary: 'Submit dispute evidence for a milestone',
    description: 'Only buyer or supplier can submit evidence when milestone is DISPUTED. Supports optional file upload (max 10MB).',
  })
  @ApiResponse({ status: 201, description: 'Evidence submitted successfully' })
  @ApiResponse({ status: 403, description: 'Not authorized to submit evidence' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  @ApiResponse({ status: 409, description: 'Milestone is not in DISPUTED status or already resolved' })
  async submitDisputeEvidence(
    @Param('shipmentId') shipmentId: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SubmitDisputeEvidenceDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.submitDisputeEvidence(
      shipmentId,
      index,
      user.stellarAddress,
      dto.description,
      file,
    );
  }

  @Get(':index/dispute-evidence')
  @ApiOperation({ 
    summary: 'Get all dispute evidence for a milestone',
    description: 'Restricted to shipment participants (buyer, supplier, logistics, arbiter) and admins.',
  })
  @ApiResponse({ status: 200, description: 'Evidence list retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Not authorized to view evidence' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  async getDisputeEvidence(
    @Param('shipmentId') shipmentId: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: any,
  ) {
    return this.milestonesService.getDisputeEvidence(
      shipmentId,
      index,
      user.stellarAddress,
    );
  }
}
