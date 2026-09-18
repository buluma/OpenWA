import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entities/session.entity';
import { Message } from '../message/entities/message.entity';
import { SessionService } from './session.service';
import { SessionEngineLifecycle } from './session-engine-lifecycle.service';
import { SessionLidResolver } from './session-lid-resolver.service';
import { SessionLivenessWatchdog } from './session-liveness-watchdog.service';
import { MessageProjector } from './message-projector.service';
import { SessionErrorStore } from './session-error-store.service';
import { SessionController } from './session.controller';
import { WebhookModule } from '../webhook/webhook.module';
import { StatusStoreModule } from '../status-store/status-store.module';
import { AutomationModule } from '../automation/automation.module';

@Module({
  // WebhookModule/StatusStoreModule/AutomationModule do not import SessionModule back, so the
  // dependency is one-directional — no forwardRef() needed. AutomationModule resolves its own
  // MessageService dependency lazily (ModuleRef) instead of a module import, for the same reason.
  imports: [TypeOrmModule.forFeature([Session, Message], 'data'), WebhookModule, StatusStoreModule, AutomationModule],
  controllers: [SessionController],
  providers: [
    SessionService,
    SessionEngineLifecycle,
    SessionErrorStore,
    SessionLidResolver,
    SessionLivenessWatchdog,
    MessageProjector,
  ],
  exports: [SessionService, MessageProjector],
})
export class SessionModule {}
