
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';

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

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    return video;
  }

  createSession(id: string) {
    this.getVideo(id);

    const token = randomBytes(32).toString('hex');

    this.sessions.set(token, {
      id,
      expires: Date.now() + 5 * 60 * 1000,
    });

    return { token, expiresInSeconds: 300 };
  }

  checkSession(id: string, token: string) {
    const session = this.sessions.get(token);

    if (!session || session.id !== id || session.expires < Date.now()) {
      this.sessions.delete(token);
      throw new UnauthorizedException('Invalid or expired playback session');
    }

    return this.getVideo(id);
  }

  getLocalPath(filename: string): string {
    if (
      basename(filename) !== filename ||
      extname(filename).toLowerCase() !== '.mp4'
    ) {
      throw new NotFoundException('Invalid MP4 filename');
    }

    const path = resolve(this.videoDirectory, filename);

    try {
      if (!statSync(path).isFile()) {
        throw new Error();
      }
    } catch {
      throw new NotFoundException('Video file not found');
    }

    return path;
  }
}
