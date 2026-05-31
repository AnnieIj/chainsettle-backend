import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitDisputeEvidenceDto {
  @ApiProperty({
    description: 'Description of the evidence being submitted',
    example: 'Photos showing damaged goods upon delivery. The packaging was torn and items were broken.',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @ApiPropertyOptional({
    description: 'File upload (optional) - will be pinned to IPFS',
    type: 'string',
    format: 'binary',
  })
  @IsOptional()
  file?: any; // Handled by multer
}
