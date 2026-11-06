import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { execSync } from 'node:child_process';
import * as ffprobeStatic from 'ffprobe-static';
import * as ffmpeg from 'fluent-ffmpeg';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe';
const FFPROBE_PATH = ffprobeInstaller.path;

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);
type Video = {
  id: string;
  title: string;
  sourceType: 'local' | 'external';
  filename?: string;
  url?: string;
};

@Injectable()
export class VideoStreamService {
  private readonly videosPath = resolve(process.cwd(), 'data/videos.json');
  private readonly videoDirectory = resolve(process.cwd(), 'videos');
  private sessions = new Map<string, { id: string; expires: number }>();

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
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { id, expires: Date.now() + 60 * 60 * 1000 });
    return { token };
  }

  checkSession(id: string, token: string) {
    const session = this.sessions.get(token);
    if (!session || session.id !== id || session.expires < Date.now()) {
      if (session) this.sessions.delete(token);
      throw new UnauthorizedException('Invalid or expired playback session');
    }
    return this.getVideo(id);
  }

  getRawMp4Path(filename: string): string {
    if (
      basename(filename) !== filename ||
      extname(filename).toLowerCase() !== '.mp4'
    ) {
      throw new NotFoundException('Invalid filename');
    }
    const path = resolve(this.videoDirectory, filename);
    if (!existsSync(path))
      throw new NotFoundException('Source video file not found');
    return path;
  }

  getVideoTargetSource(video: Video): string {
    if (video.sourceType === 'external' && video.url) {
      return video.url;
    }
    if (!video.filename) throw new NotFoundException('Filename invalid');
    return this.getRawMp4Path(video.filename);
  }

  getVideoDuration(pathOrUrl: string): Promise<number> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(pathOrUrl, (err: any, metadata: ffmpeg.FfprobeData) => {
        if (err) {
          console.error(`FFprobe failed for ${pathOrUrl}:`, err.message);
          return resolve(0);
        }

        const duration = Number(metadata?.format?.duration);
        resolve(duration > 0 ? duration : 0);
      });
    });
  }


}
