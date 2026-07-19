import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Session } from '../../modules/session/entities/session.entity';

/**
 * Persisted Baileys contact store — same rationale as {@link BaileysStoredChat}: contacts arrive
 * only via `contacts.*` / `messaging-history.set` events into an in-memory map wiped by every
 * process restart, with no live "list all contacts" API to rebuild it on demand. CASCADE-deleted
 * with its session.
 */
@Entity('baileys_stored_contacts')
@Index(['sessionId', 'waId'], { unique: true })
export class BaileysStoredContact {
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
  serializedContact: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
