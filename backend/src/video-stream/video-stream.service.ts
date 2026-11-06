import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, basename, extname, join } from 'node:path';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import type { Response } from 'express';
import * as ffprobeStatic from 'ffprobe-static';
import ffmpegStatic from 'ffmpeg-static';
import axios from 'axios';
export type Video = {
  id: string;
  title: string;
  sourceType: 'local' | 'external';
  filename?: string;
  folderId?: string;
  url?: string;
};

type SessionData = {
  id: string;
  token: string;
  expires: number;
  sessionDir: string;
  process?: ChildProcess;
};

@Injectable()
export class VideoStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly videosPath = resolve(process.cwd(), 'data/videos.json');
  private readonly videoDirectory = resolve(process.cwd(), 'videos');
  private sessions = new Map<string, SessionData>();
  private readonly baseCacheDir = resolve(process.cwd(), 'video_cache');

  // constant for segment duration in seconds
  private readonly SEGMENT_DURATION = 10;

  async onModuleInit() {
    if (!existsSync(this.baseCacheDir)) {
      mkdirSync(this.baseCacheDir, { recursive: true });
    }

    try {
      const videos = this.listVideos();
      for (const video of videos) {
        if (video.sourceType === 'external') {
          this.startWorkerForVideo(video);
        }
      }
    } catch (err: any) {
      console.error(
        `[VideoStreamService] Warmup initialization failed: ${err.message}`,
      );
    }
  }

  onModuleDestroy() {
    for (const session of this.sessions.values()) {
      if (session.process) {
        session.process.kill('SIGKILL');
      }
    }
    this.sessions.clear();
  }

  listVideos(): Video[] {
    try {
      if (!existsSync(this.videosPath)) return [];
      return JSON.parse(readFileSync(this.videosPath, 'utf8')) as Video[];
    } catch {
      return [];
    }
  }

  getVideo(id: string): Video {
    const video = this.listVideos().find((item) => item.id === id);
    if (!video)
      throw new NotFoundException('Video configuration profile not found');
    return video;
  }

  createSession(id: string) {
    this.getVideo(id);
    const token = id;
    const sessionDir = join(this.baseCacheDir, token);

    if (this.sessions.has(token)) {
      return { token };
    }

    mkdirSync(sessionDir, { recursive: true });
    this.sessions.set(token, {
      id,
      token,
      expires: Date.now() + 60 * 60 * 1000,
      sessionDir,
    });

    return { token };
  }

  checkSession(id: string, token: string): Video {
    const session = this.sessions.get(token);
    if (!session || session.id !== id) {
      throw new UnauthorizedException(
        'Access denied: Active playback session required',
      );
    }
    return this.getVideo(id);
  }

  getRawMp4Path(filename: string, folderId?: string): string {
    if (
      basename(filename) !== filename ||
      extname(filename).toLowerCase() !== '.mp4'
    ) {
      throw new NotFoundException(
        'Security error: Malformed video file layout syntax',
      );
    }
    const path = folderId
      ? resolve(this.videoDirectory, folderId, filename)
      : resolve(this.videoDirectory, filename);

    if (!existsSync(path))
      throw new NotFoundException('Media track resource asset file missing');
    return path;
  }

  getVideoTargetSource(video: Video): string {
    if (video.sourceType === 'external' && video.url) {
      return video.url;
    }
    if (!video.filename)
      throw new NotFoundException(
        'Missing structural context filename attributes',
      );
    return this.getRawMp4Path(video.filename, video.folderId);
  }

  getVideoDuration(pathOrUrl: string): number {
    try {
      const output = execSync(
        `"${ffprobeStatic.path}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${pathOrUrl}"`,
        { timeout: 5000 },
      )
        .toString()
        .trim();

      const duration = parseFloat(output);
      return !isNaN(duration) && duration > 0 ? duration : 0;
    } catch {
      return 0;
    }
  }

  private startWorkerForVideo(video: Video) {
    const videoSource = this.getVideoTargetSource(video);
    const token = video.id;
    const sessionDir = join(this.baseCacheDir, token);
    const playlistPath = join(sessionDir, 'playlist.m3u8');

    if (existsSync(playlistPath)) {
      this.sessions.set(token, {
        id: video.id,
        token,
        expires: Date.now() + 24 * 60 * 60 * 1000,
        sessionDir,
      });
      console.log(
        `[VideoCache]: Video ID "${video.id}" ${video.title} is already cached.`,
      );
      return;
    }

    mkdirSync(sessionDir, { recursive: true });
    let ffmpegProcess: ChildProcess | undefined;

    const isM3U8 = videoSource.toLowerCase().includes('.m3u8');
    const ffmpegArgs = isM3U8
      ? [
          '-protocol_whitelist',
          'file,http,https,tcp,tls,crypto',
          '-headers',
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n',
          '-i',
          videoSource,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'copy',
          '-hls_time',
          this.SEGMENT_DURATION.toString(),
          '-hls_list_size',
          '0',
          '-hls_playlist_type',
          'vod',
          '-hls_segment_filename',
          join(sessionDir, 'segment_%d.ts'),
          playlistPath,
        ]
      : [
          '-protocol_whitelist',
          'file,http,https,tcp,tls',
          '-headers',
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n',
          '-i',
          videoSource,
          '-c:v',
          'copy',
          '-c:a',
          'copy',
          '-bsf:v',
          'h264_mp4toannexb',
          '-hls_time',
          this.SEGMENT_DURATION.toString(),
          '-hls_list_size',
          '0',
          '-hls_playlist_type',
          'vod',
          '-hls_segment_filename',
          join(sessionDir, 'segment_%d.ts'),
          playlistPath,
        ];

    if (ffmpegStatic) {
      ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs);

      ffmpegProcess.stderr?.on('data', () => {});
      ffmpegProcess.on('exit', (code) => {
        if (code === 0 || code === null) {
          console.log(
            `[VideoCache] Success: Video ID "${video.id}" (${video.title}) has finished downloading entirely.`,
          );
        } else {
          console.error(
            `[VideoCache] Error: Video download failed for ID "${video.id}" (Exit code: ${code}).`,
          );
        }
      });
    }

    this.sessions.set(token, {
      id: video.id,
      token,
      expires: Date.now() + 24 * 60 * 60 * 1000,
      sessionDir,
      process: ffmpegProcess,
    });
  }

  async handlePlaylistStreaming(id: string, token: string, res: Response) {
    const video = this.checkSession(id, token);
    const videoSource = this.getVideoTargetSource(video);

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (video.sourceType === 'external') {
      const manifestPath = join(this.baseCacheDir, token, 'playlist.m3u8');
      await this.pollForFile(manifestPath, res, 40);
      return;
    }

    let duration = this.getVideoDuration(videoSource);
    if (duration === 0) duration = 60;

    let manifest = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${this.SEGMENT_DURATION}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n`;
    let remainingTime = duration;
    let index = 0;
    while (remainingTime > 0) {
      const currentChunkLength = Math.min(this.SEGMENT_DURATION, remainingTime);
      manifest += `#EXTINF:${currentChunkLength.toFixed(6)},\n`;
      manifest += `segment_${index}.ts\n`;
      remainingTime -= currentChunkLength;
      index++;
    }
    manifest += '#EXT-X-ENDLIST';
    res.status(200).send(manifest);
  }

  async handleSegmentStreaming(
    id: string,
    indexStr: string,
    token: string,
    res: Response,
  ) {
    const video = this.checkSession(id, token);
    const videoSource = this.getVideoTargetSource(video);
    const index = Number(indexStr);
    const startTime = index * this.SEGMENT_DURATION;

    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    if (video.sourceType !== 'external') {
      if (!ffmpegStatic)
        throw new NotFoundException(
          'Dynamic native encoding components are missing.',
        );

      const ffmpegArgs = [
        '-ss',
        startTime.toString(),
        '-t',
        this.SEGMENT_DURATION.toString(),
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
      res.on('close', () => ffmpeg.kill('SIGKILL'));
      return;
    }

    if (id === '7') {
      console.log(
        `https://res.cloudinary.com/jbkfusy9/video/upload/v1793792402/segment_${index}.ts`,
      );
      const cloudinaryUrl = `https://res.cloudinary.com/jbkfusy9/video/upload/v1793792402/segment_${index}.ts`;

      try {
        const streamResponse = await axios.get(cloudinaryUrl, {
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        });

        res.setHeader('Content-Type', 'video/MP2T');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

        console.log(
          `[VideoStreamService] Successfully proxied segment ${index} from Cloudinary.`,
        );

        return streamResponse.data.pipe(res);
      } catch (error: any) {
        console.error(
          `Failed to proxy segment ${index} from Cloudinary:`,
          error.message,
        );
        return res.status(404).end();
      }
    }

    const filePath = join(this.baseCacheDir, token, `segment_${index}.ts`);

    await this.pollForFile(filePath, res, 50);
  }  

  private pollForFile(
    filePath: string,
    res: Response,
    maxAttempts: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (existsSync(filePath)) {
        res.sendFile(filePath);
        return resolve();
      }

      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (existsSync(filePath)) {
          clearInterval(interval);
          res.sendFile(filePath);
          return resolve();
        }
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          if (!res.headersSent) res.status(404).end();
          return resolve();
        }
      }, 100);
    });
  }
}
