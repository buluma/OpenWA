import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Session } from '../../modules/session/entities/session.entity';

/**
 * Persisted Baileys chat store (the lib ships none — chats arrive only via `chats.*` /
 * `messaging-history.set` events into an in-memory map that a process restart wipes clean). Holds
 * the serialized `Chat` record (plain JSON — no Buffer/Long fields on this type, unlike WAMessage)
 * so `BaileysSessionStore` can reload every known chat on reconnect instead of waiting for WhatsApp
 * to resend one chat at a time as new activity arrives. CASCADE-deleted with its session.
 */
@Entity('baileys_stored_chats')
@Index(['sessionId', 'waId'], { unique: true })
export class BaileysStoredChat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session?: Session;

  @Column()
  waId: string;

  @Column({ type: 'text' })
  serializedChat: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
