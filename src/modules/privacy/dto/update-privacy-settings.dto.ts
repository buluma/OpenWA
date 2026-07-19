import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';

const VISIBILITY = ['all', 'contacts', 'contact_blacklist', 'none'] as const;
const ONLINE_VISIBILITY = ['all', 'match_last_seen'] as const;
const GROUP_ADD_VISIBILITY = ['all', 'contacts', 'contact_blacklist'] as const;
const MESSAGES_VISIBILITY = ['all', 'contacts'] as const;
const CALL_VISIBILITY = ['all', 'known'] as const;
const READ_RECEIPTS = ['all', 'none'] as const;

/**
 * Every field is optional: only the fields present are updated, each via its own engine call.
 * Baileys only — whatsapp-web.js has no privacy-settings API and returns 501 for any field.
 */
export class UpdatePrivacySettingsDto {
  @ApiPropertyOptional({ enum: VISIBILITY, description: 'Who can see your last-seen timestamp' })
  @IsOptional()
  @IsIn(VISIBILITY)
  lastSeen?: (typeof VISIBILITY)[number];

  @ApiPropertyOptional({ enum: ONLINE_VISIBILITY, description: 'Who can see your online status' })
  @IsOptional()
  @IsIn(ONLINE_VISIBILITY)
  online?: (typeof ONLINE_VISIBILITY)[number];

  @ApiPropertyOptional({ enum: VISIBILITY, description: 'Who can see your profile picture' })
  @IsOptional()
  @IsIn(VISIBILITY)
  profilePicture?: (typeof VISIBILITY)[number];

  @ApiPropertyOptional({ enum: VISIBILITY, description: 'Who can see your status/about text' })
  @IsOptional()
  @IsIn(VISIBILITY)
  status?: (typeof VISIBILITY)[number];

  @ApiPropertyOptional({ enum: READ_RECEIPTS, description: 'Whether read receipts are sent' })
  @IsOptional()
  @IsIn(READ_RECEIPTS)
  readReceipts?: (typeof READ_RECEIPTS)[number];

  @ApiPropertyOptional({ enum: GROUP_ADD_VISIBILITY, description: 'Who can add you to groups' })
  @IsOptional()
  @IsIn(GROUP_ADD_VISIBILITY)
  groupsAdd?: (typeof GROUP_ADD_VISIBILITY)[number];

  @ApiPropertyOptional({ enum: CALL_VISIBILITY, description: 'Who can call you' })
  @IsOptional()
  @IsIn(CALL_VISIBILITY)
  call?: (typeof CALL_VISIBILITY)[number];

  @ApiPropertyOptional({ enum: MESSAGES_VISIBILITY, description: 'Who can message you' })
  @IsOptional()
  @IsIn(MESSAGES_VISIBILITY)
  messages?: (typeof MESSAGES_VISIBILITY)[number];

  @ApiPropertyOptional({ description: 'Disable link previews for messages you send' })
  @IsOptional()
  @IsBoolean()
  disableLinkPreviews?: boolean;

  @ApiPropertyOptional({ description: 'Default disappearing-messages timer (seconds) for new chats; 0 disables it' })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDisappearingMode?: number;
}
