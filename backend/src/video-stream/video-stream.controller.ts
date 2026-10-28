
import {
  Controller,
  Get,
  Post,
  Param,
  Headers,
  Res,
  Req,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream, statSync } from 'node:fs';
import axios from 'axios';
import { VideoStreamService } from './video-stream.service';

const CHUNK_SIZE = 1024 * 1024;

@Controller('api/video-stream')
export class VideoStreamController {
  constructor(private readonly service: VideoStreamService) { }

  @Post('videos')
  listVideos() {
    return this.service.listVideos().map(({ id, title, sourceType }) => ({
      id,
      title,
      sourceType,
    }));
  }

  @Post('session/:id')
  createVideoSession(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session: unknown = this.service.createSession(id);

    let token: unknown;

    if (typeof session === 'string') {
      token = session;
    } else if (
      typeof session === 'object' &&
      session !== null &&
      'token' in session
    ) {
      token = session.token;
    }

    if (typeof token !== 'string' || !token) {
      throw new ForbiddenException('Unable to create video session');
    }

    res.cookie(`video_session_${id}`, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
      path: '/',
    });

    return { message: 'Video session created' };
  }

  @Get('stream/:id')
  async streamVideo(
    @Param('id') id: string,
    @Req() req: Request,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const cookieValue: unknown =
      req.cookies?.[`video_session_${id}`];

    if (!cookieValue) {
      throw new ForbiddenException('Video session cookie missing');
    }

    let token: unknown = cookieValue;

    if (typeof cookieValue === 'object' && cookieValue !== null) {
      token = 'token' in cookieValue ? cookieValue.token : undefined;
    } else if (
      typeof cookieValue === 'string' &&
      cookieValue.startsWith('j:')
    ) {
      try {
        const parsed: unknown = JSON.parse(cookieValue.slice(2));

        token =
          typeof parsed === 'object' && parsed !== null && 'token' in parsed
            ? parsed.token
            : undefined;
      } catch {
        throw new ForbiddenException('Invalid video session cookie');
      }
    }

    if (typeof token !== 'string' || !token) {
      throw new ForbiddenException('Invalid video session token');
    }

    const video = this.service.checkSession(id, token);

    const rangeHeader = range || `bytes=0-${CHUNK_SIZE - 1}`;
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);

    if (!match) {
      throw new BadRequestException('Invalid byte range');
    }

    const start = Number(match[1]);
    const requestedEnd = match[2]
      ? Number(match[2])
      : start + CHUNK_SIZE - 1;

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(requestedEnd) ||
      start < 0 ||
      requestedEnd < start ||
      requestedEnd - start + 1 > CHUNK_SIZE
    ) {
      throw new BadRequestException('Maximum range is 1 MB');
    }

    const end = Math.min(requestedEnd, start + CHUNK_SIZE - 1);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Stream a local MP4 file.
    if (video.sourceType === 'local') {
      if (!video.filename) {
        throw new NotFoundException('Filename missing');
      }

      const path = this.service.getLocalPath(video.filename);

      let size: number;

      try {
        size = statSync(path).size;
      } catch {
        throw new NotFoundException('Video file not found');
      }

      if (start >= size) {
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }

      const actualEnd = Math.min(end, size - 1);

      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${start}-${actualEnd}/${size}`,
      );
      res.setHeader('Content-Length', actualEnd - start + 1);

      const stream = createReadStream(path, {
        start,
        end: actualEnd,
      });

      stream.on('error', () => res.destroy());
      return stream.pipe(res);
    }

    // Stream an external HTTPS MP4 URL.
    if (!video.url || !video.url.startsWith('https://')) {
      throw new NotFoundException('Invalid external MP4 URL');
    }

    try {
      const remote = await axios.get(video.url, {
        responseType: 'stream',
        headers: {
          Range: `bytes=${start}-${end}`,
        },
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: (status) => status === 206,
      });

      res.status(206);

      for (const header of [
        'content-range',
        'content-length',
        'accept-ranges',
      ]) {
        const value = remote.headers[header];

        if (value) {
          const responseHeader =
            header === 'content-range'
              ? 'Content-Range'
              : header === 'content-length'
                ? 'Content-Length'
                : 'Accept-Ranges';

          res.setHeader(responseHeader, String(value));
        }
      }

      remote.data.on('error', () => res.destroy());
      return remote.data.pipe(res);
    } catch {
      if (!res.headersSent) {
        throw new ServiceUnavailableException(
          'External server must support MP4 byte ranges',
        );
      }

      res.destroy();
    }
  }
}
