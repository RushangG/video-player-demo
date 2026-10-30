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

    if (!ffmpegStatic) {
      throw new NotFoundException('FFmpeg binary path missing.');
    }

    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    let ffmpegArgs: string[] = [];
    const isExternal = video.sourceType === 'external';
    const isM3U8 = videoSource.toLowerCase().includes('.m3u8');

    if (!isExternal) {
      // Local MP4 Configuration
      ffmpegArgs = [
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
    } else if (isM3U8) {
      // External M3U8 Configuration
      ffmpegArgs = [
        '-protocol_whitelist',
        'file,http,https,tcp,tls',
        '-headers',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n',
        '-i',
        videoSource,
        '-ss',
        startTime.toString(),
        '-t',
        SEGMENT_DURATION.toString(),
        '-output_ts_offset',
        startTime.toString(),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'zerolatency',
        '-g',
        '30',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-fflags',
        '+nobuffer+flush_packets',
        '-f',
        'mpegts',
        'pipe:1',
      ];
    } else {
      // External MP4 Configuration
      ffmpegArgs = [
        '-protocol_whitelist',
        'file,http,https,tcp,tls',
        '-headers',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n',
        '-fflags',
        '+nobuffer+flush_packets',
        '-rw_timeout',
        '5000000',
        '-analyzeduration',
        '100000',
        '-probesize',
        '100000',
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
    }

    const ffmpeg = spawn(ffmpegStatic, ffmpegArgs);
    let errorLog = '';

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorLog += chunk.toString('utf8');
      if (errorLog.length > 500) errorLog = errorLog.slice(-500);
    });

    ffmpeg.on('error', (err) => {
      console.error(`FFmpeg spawn failure on chunk ${index}:`, err.message);
      if (!res.headersSent) res.status(500).end();
    });

    ffmpeg.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(
          `FFmpeg exited with error code ${code} on chunk ${index}.\n${errorLog}`,
        );
      }
    });

    ffmpeg.stdout.pipe(res);

    res.on('close', () => {
      ffmpeg.kill('SIGKILL');
    });
  }

  private extractToken(id: string, req: Request): string {
    const cookieValue = req.cookies?.[`video_session_${id}`];
    if (!cookieValue) throw new ForbiddenException('Session missing');
    return typeof cookieValue === 'object' ? cookieValue?.token : cookieValue;
  }
}
