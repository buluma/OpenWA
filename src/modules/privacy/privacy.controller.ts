import { Controller, Get, Patch, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PrivacyService } from './privacy.service';
import { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('privacy')
@Controller('sessions/:sessionId/privacy')
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Get('settings')
  @ApiOperation({
    summary: 'Get the account privacy settings',
    description: 'Raw settings as WhatsApp reports them (undocumented, engine-specific keys). Baileys only.',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Privacy settings' })
  @ApiResponse({ status: 501, description: 'Not supported by the active engine' })
  getSettings(@Param('sessionId') sessionId: string) {
    return this.privacyService.getSettings(sessionId);
  }

  @Get('blocklist')
  @ApiOperation({ summary: 'Get the ids of contacts blocked on this account' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'List of blocked contact ids' })
  async getBlocklist(@Param('sessionId') sessionId: string) {
    return { blocklist: await this.privacyService.getBlocklist(sessionId) };
  }

  @Patch('settings')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update one or more privacy settings',
    description: 'Only the fields present in the body are changed. Baileys only; whatsapp-web.js returns 501.',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  @ApiResponse({ status: 501, description: 'Not supported by the active engine' })
  async updateSettings(@Param('sessionId') sessionId: string, @Body() dto: UpdatePrivacySettingsDto) {
    await this.privacyService.updateSettings(sessionId, dto);
    return { success: true };
  }
}
