import { Global, Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service';
import {
  EVENTS_PROCESSED_COUNTER,
  EVENTS_FAILED_COUNTER,
  SHIPMENTS_CREATED_COUNTER,
  ACTIVE_SHIPMENTS_GAUGE,
} from './metrics.service';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true },
    }),
  ],
  providers: [
    makeCounterProvider({
      name: EVENTS_PROCESSED_COUNTER,
      help: 'Total number of on-chain events processed',
      labelNames: ['eventName'],
    }),
    makeCounterProvider({
      name: EVENTS_FAILED_COUNTER,
      help: 'Total number of on-chain events that failed processing',
    }),
    makeCounterProvider({
      name: SHIPMENTS_CREATED_COUNTER,
      help: 'Total number of shipments created',
    }),
    makeGaugeProvider({
      name: ACTIVE_SHIPMENTS_GAUGE,
      help: 'Current number of active shipments',
    }),
    MetricsService,
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
