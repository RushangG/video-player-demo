import type { VideoProgress } from "../types/video";

const KEY = "SVP_PROGRESS";
type ProgressDb = Record<string, VideoProgress>; // key = `${userId}:${videoId}`

const makeKey = (userId: string, videoId: string) => `${userId}:${videoId}`;

function readAll(): ProgressDb {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProgressDb) : {};
  } catch {
    return {};
  }
}

export function emptyProgress(userId: string, videoId: string): VideoProgress {
  return {
    userId,
    videoId,
    watchedIntervals: [],
    watchedSeconds: 0,
    watchPercentage: 0,
    earnedXP: 0,
    completed: false,
    lastPositionSeconds: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function getProgress(userId: string, videoId: string): VideoProgress | null {
  return readAll()[makeKey(userId, videoId)] ?? null;
}

/** All progress of one student, keyed by videoId. */
export function getProgressMapForUser(userId: string): Record<string, VideoProgress> {
  const out: Record<string, VideoProgress> = {};
  Object.values(readAll()).forEach((p) => {
    if (p.userId === userId) out[p.videoId] = p;
  });
  return out;
}

export function saveProgress(progress: VideoProgress): boolean {
  try {
    const db = readAll();
    db[makeKey(progress.userId, progress.videoId)] = {
      ...progress,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch (err) {
    console.error("Could not save progress", err);
    return false;
  }
}

export function deleteProgressForVideo(videoId: string): void {
  try {
    const db = readAll();
    Object.keys(db).forEach((k) => {
      if (db[k].videoId === videoId) delete db[k];
    });
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    console.error("Delete progress error : ", err);
  }
}
