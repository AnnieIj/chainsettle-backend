import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({
    example: 'CI Pipeline',
    description: 'A human-readable label for this API key',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;
}