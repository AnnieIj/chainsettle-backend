import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { MilestonesService } from './milestones.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/** Maximum allowed proof file size: 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Accepted MIME types for proof documents */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
];

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

  /**
   * POST /api/v1/shipments/:shipmentId/milestones/:index/proof
   *
   * Accepts a multipart/form-data upload with a "file" field containing
   * the proof document. Pins it to IPFS via Pinata, stores the resulting
   * CID in the database, and notifies the buyer.
   *
   * Restricted to the shipment's supplierAddress or logisticsAddress.
   */
  @Post(':index/proof')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit proof of delivery for a milestone',
    description:
      'Pins the uploaded file to IPFS (via Pinata) and stores the CID in the milestone record. ' +
      'Only the shipment\'s supplierAddress or logisticsAddress may call this endpoint.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'Proof document (PDF, image, or video). Maximum 50 MB.',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Proof pinned to IPFS and milestone updated',
    schema: {
      example: {
        milestone: {
          id: 'uuid',
          shipmentId: 'ship-001',
          milestoneIndex: 0,
          status: 'PROOF_SUBMITTED',
          proofHash: 'bafybeig...',
        },
        cid: 'bafybeig...',
        gatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafybeig...',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'No file uploaded or invalid type' })
  @ApiResponse({ status: 403, description: 'Caller is not the supplier or logistics provider' })
  @ApiResponse({ status: 404, description: 'Shipment or milestone not found' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter(
        _req,
        file: Express.Multer.File,
        callback: (error: Error | null, acceptFile: boolean) => void,
      ) {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return callback(
            new BadRequestException(
              `Unsupported file type: ${file.mimetype}. Allowed: PDF, images, MP4.`,
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async submitProof(
    @Param('shipmentId') shipmentId: string,
    @Param('index', ParseIntPipe) index: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('A proof file must be provided in the "file" field');
    }

    // The JWT payload carries the Stellar address as `sub` or `stellarAddress`
    const callerAddress: string = user?.stellarAddress ?? user?.sub;

    return this.milestonesService.submitProof(
      shipmentId,
      index,
      callerAddress,
      file,
    );
  }
}
