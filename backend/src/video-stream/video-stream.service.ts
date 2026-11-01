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

  async onModuleInit() {
    if (!existsSync(this.baseCacheDir)) {
      mkdirSync(this.baseCacheDir, { recursive: true });
    }
    console.log(
      `[VideoCache] Root verified relative to project: ${this.baseCacheDir}`,
    );

    try {
      const videos = this.listVideos();
      console.log(
        '[Warmup] Server boot detected. Checking and preparing video caches',
      );
      for (const video of videos) {
        if (video.sourceType === 'external') {
          this.startWorkerForVideo(video);
        }
      }
    } catch (err: any) {
      console.error('[Warmup] Error parsing video data registry:', err.message);
    }
  }

  onModuleDestroy() {
    console.log('[VideoCache] Cleaning up active background stream workers...');
    for (const [token, session] of this.sessions.entries()) {
      if (session.process) {
        session.process.kill('SIGKILL');
      }
    }
  }

  private startWorkerForVideo(video: Video) {
    const videoSource = this.getVideoTargetSource(video);
    const token = video.id;
    const sessionDir = join(this.baseCacheDir, token);
    const playlistPath = join(sessionDir, 'playlist.m3u8');

    if (existsSync(playlistPath)) {
      console.log(
        `[Warmup] Video ID ${video.id} already processed. Cache reused.`,
      );
      this.sessions.set(token, {
        id: video.id,
        expires: Date.now() + 24 * 60 * 60 * 1000,
        sessionDir,
      });
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

      ffmpegProcess.on('exit', (code) => {
        if (code === 0 || code === null) {
          console.log(
            `[Worker] Video ID ${video.id} processing completed successfully.`,
          );
        } else {
          console.error(
            `[Worker] Video ID ${video.id} exited with error status code: ${code}`,
          );
        }
      });
    }

    this.sessions.set(token, {
      id: video.id,
      expires: Date.now() + 24 * 60 * 60 * 1000,
      sessionDir,
      process: ffmpegProcess,
    });
  }

  listVideos(): Video[] {
    return JSON.parse(readFileSync(this.videosPath, 'utf8')) as Video[];
  }

  getVideo(id: string): Video {
    const video = this.listVideos().find((item) => item.id === id);
    if (!video) throw new NotFoundException('Video not found');
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
      expires: Date.now() + 60 * 60 * 1000,
      sessionDir,
    });

    return { token };
  }

  checkSession(id: string, token: string) {
    const session = this.sessions.get(token);
    if (!session || session.id !== id) {
      throw new UnauthorizedException('Invalid or expired playback session');
    }
    return this.getVideo(id);
  }

  cleanupSession(token: string) {}

  getSessionDir(token: string): string {
    return join(this.baseCacheDir, token);
  }

  getRawMp4Path(filename: string, folderId?: string): string {
    if (
      basename(filename) !== filename ||
      extname(filename).toLowerCase() !== '.mp4'
    ) {
      throw new NotFoundException('Invalid filename');
    }
    const path = folderId
      ? resolve(this.videoDirectory, folderId, filename)
      : resolve(this.videoDirectory, filename);

    if (!existsSync(path))
      throw new NotFoundException('Source video file not found');
    return path;
  }

  getVideoTargetSource(video: Video): string {
    if (video.sourceType === 'external' && video.url) {
      return video.url;
    }
    if (!video.filename) throw new NotFoundException('Filename invalid');
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
    } catch (e) {
      return 0;
    }
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
