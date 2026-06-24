import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { TokenRegistryService } from './token-registry.service';
import { RedisService } from '../redis/redis.service';

const CACHE_KEY = 'token_registry:list';
const CACHE_TTL = 300; // 5 minutes

@ApiTags('tokens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tokens')
export class TokenRegistryController {
  constructor(
    private readonly tokenRegistry: TokenRegistryService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all supported payment tokens' })
  @ApiResponse({ status: 200, description: 'Sorted list of registered tokens' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listTokens() {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    const tokens = this.tokenRegistry.listTokens();
    await this.redis.set(CACHE_KEY, JSON.stringify(tokens), CACHE_TTL);
    return tokens;
  }
}
