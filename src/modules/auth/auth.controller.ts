// auth.controller.ts
import { Controller, Post, Get, Body, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { StellarAddressThrottlerGuard } from '../../common/guards/stellar-address-throttler.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('nonce')
  @UseGuards(StellarAddressThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get a challenge nonce for a Stellar address' })
  @ApiResponse({ status: 200, description: 'Returns a nonce to be signed by the wallet' })
  @ApiResponse({ status: 429, description: 'Too many requests - rate limit exceeded' })
  async getNonce(@Query('address') address: string) {
    const nonce = await this.authService.generateNonce(address);
    return { nonce, address };
  }

  @Post('login')
  @UseGuards(StellarAddressThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify signed nonce and receive a JWT' })
  @ApiResponse({ status: 200, description: 'Returns JWT access token' })
  @ApiResponse({ status: 429, description: 'Too many requests - rate limit exceeded' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
