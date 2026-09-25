import { WinstonModule } from 'nest-winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as winston from 'winston';

export function createWinstonLogger() {
  const isProd = process.env.NODE_ENV === 'production';
  const level = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');

  const prodTransport = new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
  });

  const devTransport = new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      nestWinstonModuleUtilities.format.nestLike('ChainSettle', {
        prettyPrint: true,
        colors: true,
      }),
    ),
  });

  return WinstonModule.createLogger({
    level,
    transports: [isProd ? prodTransport : devTransport],
  });
}
