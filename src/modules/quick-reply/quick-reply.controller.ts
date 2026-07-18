import { Controller, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { QuickReplyService } from './quick-reply.service';
import { UpsertQuickReplyDto } from './dto/upsert-quick-reply.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('quick-replies')
@Controller('sessions/:sessionId/quick-replies')
export class QuickReplyController {
  constructor(private readonly quickReplyService: QuickReplyService) {}

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create or edit a WhatsApp Business quick reply (canned response)',
    description: 'Pass `id` to edit an existing quick reply; omit it to create a new one. Returns the resulting id.',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Quick reply saved',
  })
  @ApiResponse({ status: 501, description: 'Not supported by the active engine' })
  async upsert(@Param('sessionId') sessionId: string, @Body() dto: UpsertQuickReplyDto) {
    const result = await this.quickReplyService.upsert(sessionId, dto);
    return { success: true, id: result.id };
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Remove a quick reply' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'id', description: 'Quick reply id (returned when it was created)' })
  @ApiResponse({
    status: 200,
    description: 'Quick reply removed',
  })
  @ApiResponse({ status: 501, description: 'Not supported by the active engine' })
  async remove(@Param('sessionId') sessionId: string, @Param('id') id: string) {
    await this.quickReplyService.remove(sessionId, id);
    return { success: true, message: 'Quick reply removed' };
  }
}
