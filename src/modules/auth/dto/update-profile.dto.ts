import { IsOptional, IsString, IsEmail, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe', description: 'User display name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'john@example.com', description: 'User email address' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
