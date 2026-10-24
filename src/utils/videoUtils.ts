import type { Interval } from "../types/video";

export const COMPLETE_THRESHOLD = 95; 

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const mm = mins.toString().padStart(2, "0");
  const ss = secs.toString().padStart(2, "0");
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mins}:${ss}`;
}

// function take intervals and merge intervals. return the merged intervals.
export function mergeIntervals(intervals: Interval[], gap = 0.25): Interval[] {
  const sorted: Interval[] = intervals
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .map(([s, e]) => [s, e] as Interval)
    .sort((a, b) => a[0] - b[0]);

  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + gap) {
      last[1] = Math.max(last[1], e);
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

export function sumIntervals(intervals: Interval[]): number {
  return intervals.reduce((total, [s, e]) => total + (e - s), 0);
}

export function calcPercentage(watchedSeconds: number, duration: number): number {
  if (!duration || duration <= 0) return 0;
  return Math.min(100, (watchedSeconds / duration) * 100);
}

/** XP = Max XP x (watch % / 100), rounded to 1 decimal. */
export function calcXP(maxXP: number, percentage: number): number {
  return Math.round(((maxXP * percentage) / 100) * 10) / 10;
}

/** Read duration of a video file / URL using a hidden <video> element. */
export function readVideoDuration(src: string, timeoutMs = 10000): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";

    const finish = (err: Error | null, value?: number) => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      if (err) reject(err);
      else resolve(value as number);
    };

    const timer = window.setTimeout(
      () => finish(new Error("Timed out while reading video metadata.")),
      timeoutMs,
    );

    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        finish(null, video.duration);
      } else {
        finish(new Error("Video duration is not available."));
      }
    };
    video.onerror = () => finish(new Error("Could not read video metadata."));
    video.src = src;
  });
}

export function guessMimeFromUrl(url: string): string {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8")) return "application/x-mpegURL";
  if (clean.endsWith(".mpd")) return "application/dash+xml";
  if (clean.endsWith(".webm")) return "video/webm";
  if (clean.endsWith(".ogv") || clean.endsWith(".ogg")) return "video/ogg";
  return "video/mp4";
}
