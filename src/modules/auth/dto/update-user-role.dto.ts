import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class UpdateUserRoleDto {
  @ApiProperty({ enum: UserRole, example: UserRole.ARBITER })
  @IsEnum(UserRole)
  role: UserRole;
}
