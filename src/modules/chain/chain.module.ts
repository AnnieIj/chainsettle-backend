import { Module } from '@nestjs/common';
import { ChainController } from './chain.controller';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [ChainController],
})
export class ChainModule {}
