import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DataConnectionHealthService } from './data-connection-health.service';

@Module({
  controllers: [HealthController],
  providers: [DataConnectionHealthService],
})
export class HealthModule {}
