import { Module } from '@nestjs/common';
import { QuickReplyController } from './quick-reply.controller';
import { QuickReplyService } from './quick-reply.service';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [QuickReplyController],
  providers: [QuickReplyService],
  exports: [QuickReplyService],
})
export class QuickReplyModule {}
