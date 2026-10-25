import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { VideoData, VideoProgress } from "../types/video";
import {
  DEMO_USERS,
  getCurrentUserId,
  setCurrentUserId,
} from "../config/demoUser";
import { getVideos } from "../services/videoStorage";
import { getProgressMapForUser } from "../services/progressStorage";
import { formatTime } from "../utils/videoUtils";

export default function VideoPortal() {
  const [userId, setUserId] = useState(getCurrentUserId());
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [progress, setProgress] = useState<Record<string, VideoProgress>>({});

  const refresh = useCallback(() => {
    setVideos(getVideos());
    setProgress(getProgressMapForUser(getCurrentUserId()));
  }, []);

  // Refresh
  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, userId]);

  const changeUser = (id: string) => {
    setCurrentUserId(id);
    setUserId(id);
  };

  // only video id.
  const watch = (videoId: string) => {
    // one time token for security
    const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(`svp_token_${videoId}`, token);

    const w = window.screen.availWidth;
    const h = window.screen.availHeight;
    window.open(
      `/player/${videoId}`,
      "SecureVideoWindow",
      `popup=yes,width=${w},height=${h},left=0,top=0,noopener`,
    );
  };

  // const totalXP = Object.values(progress).reduce((sum, p) => sum + p.earnedXP, 0);
  // const maxTotalXP = videos.reduce((sum, v) => sum + v.maxXP, 0);

  return (
    <div className="card">
      <div className="row">
        <h2>Video portal</h2>
        <label>
          Student{" "}
          <select value={userId} onChange={(e) => changeUser(e.target.value)}>
            {DEMO_USERS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </div>

      {videos.length === 0 ? (
        <p className="muted">
          No videos yet. <Link to="/admin">Add a video</Link> first.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Topic</th>
              <th>Duration</th>
              <th>Progress</th>
              <th>XP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {videos.map((v, i) => {
              const p = progress[v.id];
              const pct = Math.round(p?.watchPercentage ?? 0);
              const label = p?.completed
                ? "Watch again"
                : pct > 0
                  ? "Resume"
                  : "Watch";
              return (
                <tr key={v.id}>
                  <td>{i + 1}</td>
                  <td>{v.topicName}</td>
                  <td>
                    {v.durationSeconds ? formatTime(v.durationSeconds) : "—"}
                  </td>
                  <td>
                    <div className="bar">
                      <div className="bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <small>
                      {pct}% {p?.completed && "· completed"}
                    </small>
                  </td>
                  <td>
                    {p?.earnedXP ?? 0} / {v.maxXP}
                  </td>
                  <td>
                    <button onClick={() => watch(v.id)}>{label}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
