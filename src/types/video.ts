export type VideoSourceType = "VIDEO_LINK" | "VIDEO_UPLOAD";

export interface VideoData {
  id: string;
  topicName: string;
  maxXP: number;
  sourceType: VideoSourceType;
  sourceUrl?: string; 
  fileId?: string; 
  mimeType?: string; 
  durationSeconds: number; 
  createdAt: string;
}

export type Interval = [number, number];

export interface VideoProgress {
  userId: string;
  videoId: string;
  watchedIntervals: Interval[]; 
  watchedSeconds: number;
  watchPercentage: number; 
  earnedXP: number;
  completed: boolean;
  lastPositionSeconds: number;
  updatedAt: string;
}
