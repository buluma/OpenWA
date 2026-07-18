import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertQuickReplyDto {
  @ApiPropertyOptional({
    description: 'Existing quick reply id to edit. Omit to create a new one.',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ description: 'Shortcut text that triggers this quick reply (e.g. "/hi")', maxLength: 64 })
  @IsString()
  @MaxLength(64)
  shortcut: string;

  @ApiProperty({ description: 'The message body sent when the shortcut is used', maxLength: 4096 })
  @IsString()
  @MaxLength(4096)
  message: string;

  @ApiPropertyOptional({ description: 'Optional keywords that also trigger this quick reply', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
