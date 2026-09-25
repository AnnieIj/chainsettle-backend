import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LogoutDto {
    @ApiProperty({ description: 'Plaintext refresh token' })
    @IsString()
    @IsNotEmpty()
    refreshToken: string;
}

