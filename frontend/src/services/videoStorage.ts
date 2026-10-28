import type { VideoData } from "../types/video";
import { deleteFile } from "./fileStorage";
import { deleteProgressForVideo } from "./progressStorage";

const KEY = "SVP_VIDEOS";

export function getVideos(): VideoData[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as VideoData[]) : [];
  } catch {
    return [];
  }
}

function writeVideos(videos: VideoData[]): void {
  localStorage.setItem(KEY, JSON.stringify(videos));
}

export function getVideoById(id: string): VideoData | null {
  return getVideos().find((v) => v.id === id) ?? null;
}

export function saveVideo(video: VideoData): void {
  writeVideos([...getVideos(), video]);
}

export function updateVideo(id: string, patch: Partial<VideoData>): void {
  writeVideos(getVideos().map((v) => (v.id === id ? { ...v, ...patch } : v)));
}

export async function deleteVideo(id: string): Promise<void> {
  const video = getVideoById(id);
  writeVideos(getVideos().filter((v) => v.id !== id));
  deleteProgressForVideo(id);
  if (video?.fileId) {
    try {
      await deleteFile(video.fileId);
    } catch (err) {
      console.error("delete video error : ", err);
    }
  }
}
