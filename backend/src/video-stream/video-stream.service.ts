import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path, { resolve, basename, extname, join } from 'node:path';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import type { Response } from 'express';
import * as ffprobeStatic from 'ffprobe-static';
import * as fs from 'fs';
import * as crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { url } from 'node:inspector';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}
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
interface downloadAndChunkType {
  status: string;
  message: string;
}
const EXTERNAL_URL_SEGMENT_DURATION = 20;

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
          String(EXTERNAL_URL_SEGMENT_DURATION),
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
          String(EXTERNAL_URL_SEGMENT_DURATION),
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

      let lastLoggedSegment = -1;
      ffmpegProcess.stderr?.on('data', (chunk: Buffer) => {
        const logLine = chunk.toString('utf8');

        const segmentMatch = logLine.match(
          /Opening '.*segment_(\d+)\.ts' for writing/,
        );
        if (segmentMatch && segmentMatch[1]) {
          const segmentIndex = parseInt(segmentMatch[1], 10);
          if (segmentIndex !== lastLoggedSegment) {
            lastLoggedSegment = segmentIndex;
          }
        }
      });

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

  async downloadAndChunk(
    videoUrl: string,
    title: string,
  ): Promise<downloadAndChunkType> {
    const hashedFolderName = crypto
      .createHash('md5')
      .update(videoUrl)
      .digest('hex');

    const outputDir = path.join(process.cwd(), 'video_cache', hashedFolderName);
    const outputPlaylist = path.join(outputDir, 'playlist.m3u8');
    const segmentFilenamePattern = path.join(outputDir, 'segment_%01d.ts');

    // Check if the folder already exists
    if (fs.existsSync(outputDir)) {
      console.log(
        `Video chunks already exist for this URL. Skipping processing.`,
      );
      return {
        status: 'skipped',
        message: 'Video chunks already exist for this URL.',
      };
    }

    //Create the new folder path if it does not exist
    fs.mkdirSync(outputDir, { recursive: true });

    return new Promise((resolve, reject) => {
      //  Use FFmpeg to process the stream link
      const command = ffmpeg(videoUrl);
      command
        .outputOptions([
          '-c:v libx264',
          '-profile:v baseline',
          '-level 3.0',
          '-c:a aac',
          '-start_number 0',
          `-hls_time ${EXTERNAL_URL_SEGMENT_DURATION}`, // Duration of each chunk in seconds 
          '-hls_list_size 0',
          `-hls_segment_filename ${segmentFilenamePattern}`, //segment name
          '-f hls',
        ])
        .output(outputPlaylist)
        .on('end', async () => {
          console.log('Chunking finished successfully.');
          resolve({
            status: 'success',
            message: 'Video processed and chunked successfully',
          });

          const newVideoData = {
            id: hashedFolderName,
            title: title,
            sourceType: 'external',
            url: videoUrl,
          };
          const videoDataPath = path.join(process.cwd(), 'data', 'videos.json');

          try {
            const fileData = await fs.promises.readFile(videoDataPath, 'utf-8');
            const videosArray = JSON.parse(fileData);

            videosArray.push(newVideoData);
            fs.promises.writeFile(
              videoDataPath,
              JSON.stringify(videosArray, null, 2),
              'utf8',
            );
            console.log('Video data appended successfully!');
          } catch (error) {
            console.error('Error updating the JSON file:', error);
          }
        })
        .on('error', (err, stderr) => {
          console.error('Error processing video:', err);
          console.error('FFmpeg Stderr:', stderr);
          reject(
            new InternalServerErrorException('Failed to process video chunks'),
          );

          if (fs.existsSync(outputDir)) {
            fs.rmSync(outputDir, { recursive: true, force: true });
          }
        })
        .run();
    });
  }
}
