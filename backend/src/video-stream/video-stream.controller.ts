import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { VideoStreamService } from './video-stream.service';

@Controller('api/video-stream')
export class VideoStreamController {
  constructor(private readonly service: VideoStreamService) {}

  @Post('videos')
  listVideos() {
    return this.service
      .listVideos()
      .map(({ id, title, sourceType }) => ({ id, title, sourceType }));
  }

  @Post('session/:id')
  createVideoSession(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = this.service.createSession(id);
    res.cookie(`video_session_${id}`, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000,
      path: '/',
    });
    return { message: 'Video session created' };
  }

  @Get('stream/:id/playlist.m3u8')
  async getVirtualPlaylist(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token = this.extractToken(id, req);
    await this.service.handlePlaylistStreaming(id, token, res);
  }

  @Get('stream/:id/segment_:index.ts')
  async getVirtualSegment(
    @Param('id') id: string,
    @Param('index') index: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token = this.extractToken(id, req);
    await this.service.handleSegmentStreaming(id, index, token, res);
  }

  private extractToken(id: string, req: Request): string {
    const cookieValue = req.cookies?.[`video_session_${id}`];
    if (!cookieValue)
      throw new UnauthorizedException(
        'Authentication missing: Playback token expected',
      );
    return typeof cookieValue === 'object' ? cookieValue?.token : cookieValue;
  }
}
