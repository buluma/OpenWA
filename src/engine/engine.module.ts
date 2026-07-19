import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EngineFactory } from './engine.factory';
import { BaileysStoredMessage } from './adapters/baileys-stored-message.entity';
import { BaileysMessageStoreService } from './adapters/baileys-message-store.service';
import { BaileysStoredChat } from './adapters/baileys-stored-chat.entity';
import { BaileysStoredContact } from './adapters/baileys-stored-contact.entity';
import { BaileysSessionStateStoreService } from './adapters/baileys-session-state-store.service';
import { LidMapping } from './identity/lid-mapping.entity';
import { LidMappingStoreService } from './identity/lid-mapping-store.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([BaileysStoredMessage, BaileysStoredChat, BaileysStoredContact, LidMapping], 'data'),
  ],
  providers: [EngineFactory, BaileysMessageStoreService, BaileysSessionStateStoreService, LidMappingStoreService],
  exports: [EngineFactory, LidMappingStoreService],
})
export class EngineModule {}
