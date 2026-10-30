import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { VideoStreamService } from './video-stream.service';
import ffmpegStatic from 'ffmpeg-static';

const SEGMENT_DURATION = 4;

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
    const video = this.service.checkSession(id, token);
    const videoSource = this.service.getVideoTargetSource(video);

    if (video.sourceType === 'external') {
      const sessionDir = this.service.getSessionDir(token);
      const manifestPath = join(sessionDir, 'playlist.m3u8');

      res.setHeader('Content-Type', 'application/x-mpegURL');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (existsSync(manifestPath)) {
          clearInterval(interval);
          return res.sendFile(manifestPath);
        }
        if (attempts > 40) {
          clearInterval(interval);
          if (!res.headersSent) res.status(404).end();
        }
      }, 100);
      return;
    }

    let duration = this.service.getVideoDuration(videoSource);
    if (duration === 0) duration = 60;

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    let manifest = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${SEGMENT_DURATION}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n`;
    let remainingTime = duration;
    let index = 0;
    while (remainingTime > 0) {
      const currentChunkLength = Math.min(SEGMENT_DURATION, remainingTime);
      manifest += `#EXTINF:${currentChunkLength.toFixed(6)},\n`;
      manifest += `segment_${index}.ts\n`;
      remainingTime -= currentChunkLength;
      index++;
    }
    manifest += '#EXT-X-ENDLIST';
    return res.status(200).send(manifest);
  }

  @Get('stream/:id/segment_:index.ts')
  async getVirtualSegment(
    @Param('id') id: string,
    @Param('index') index: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token = this.extractToken(id, req);
    const video = this.service.checkSession(id, token);
    const videoSource = this.service.getVideoTargetSource(video);
    const startTime = Number(index) * SEGMENT_DURATION;

    if (!ffmpegStatic)
      throw new NotFoundException('FFmpeg binary path missing.');

    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // ROUTE 1: Local Files - High-speed on-the-fly streaming directly from local drive
    if (video.sourceType !== 'external') {
      const ffmpegArgs = [
        '-ss',
        startTime.toString(),
        '-t',
        SEGMENT_DURATION.toString(),
        '-i',
        videoSource,
        '-output_ts_offset',
        startTime.toString(),
        '-c:v',
        'copy',
        '-c:a',
        'copy',
        '-bsf:v',
        'h264_mp4toannexb',
        '-muxdelay',
        '0',
        '-f',
        'mpegts',
        'pipe:1',
      ];

      const ffmpeg = spawn(ffmpegStatic, ffmpegArgs);
      ffmpeg.stdout.pipe(res);
      res.on('close', () => {
        ffmpeg.kill('SIGKILL');
      });
      return;
    }

    // ROUTE 2 & 3: External URLs (MP4 & M3U8) - Served instantly from memory cache folder
    const sessionDir = this.service.getSessionDir(token);
    const filePath = join(sessionDir, `segment_${index}.ts`);

    if (existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (existsSync(filePath)) {
        clearInterval(interval);
        return res.sendFile(filePath);
      }
      if (attempts > 50) {
        clearInterval(interval);
        if (!res.headersSent) res.status(404).end();
      }
    }, 100);
  }

  private extractToken(id: string, req: Request): string {
    const cookieValue = req.cookies?.[`video_session_${id}`];
    if (!cookieValue) throw new ForbiddenException('Session missing');
    return typeof cookieValue === 'object' ? cookieValue?.token : cookieValue;
  }
}
