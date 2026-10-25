
import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

type VideoItem = {
  id: string;
  title: string;
  filename?: string;
  url?: string;
  streamUrl: string;
  type: string;
  mimeType?: string;
  sourceType: "local" | "external";
};

function getVideoUrl(video: VideoItem): string {
  if (video.sourceType === "external") {
    return video.url ?? video.streamUrl;
  }

  return `${API_BASE_URL.replace(/\/$/, "")}/api/video-stream/stream/id/${encodeURIComponent(video.id)}`;
}

function getVideoType(video: VideoItem): string {
  if (video.type) {
    return video.type;
  }

  if (/\.m3u8($|\?)/i.test(video.url ?? video.streamUrl)) {
    return "application/x-mpegURL";
  }

  return "video/mp4";
}

export default function VideoStream() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selected =
    videos.find((video) => video.id === selectedId) ?? null;

  useEffect(() => {
    const controller = new AbortController();

    async function loadVideos() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE_URL.replace(/\/$/, "")}/api/video-stream/videos`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Video API returned HTTP ${response.status}`);
        }

        const data: unknown = await response.json();

        if (!Array.isArray(data)) {
          throw new Error("Expected the videos API to return a JSON array.");
        }

        const items = data as VideoItem[];
        setVideos(items);

        if (items.length > 0) {
          setSelectedId(items[0].id);
        } else {
          setError("No videos were returned by the backend.");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        setError(
          err instanceof Error ? err.message : "Could not load videos.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadVideos();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const videoElement = document.createElement("video-js");
    videoElement.classList.add("video-js", "vjs-big-play-centered");
    container.appendChild(videoElement);

    const player = videojs(videoElement, {
      controls: true,
      responsive: true,
      fluid: true,
      preload: "metadata",
      html5: {
        vhs: { overrideNative: true },
      },
    });

    playerRef.current = player;

    player.on("error", () => {
      const playerError = player.error();

      setError(
        playerError
          ? `Playback failed (code ${playerError.code}). Check the video URL, format, and CORS settings.`
          : "Video playback failed.",
      );
    });

    return () => {
      playerRef.current = null;

      if (!player.isDisposed()) {
        player.dispose();
      }
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;

    if (!player || !selected) {
      return;
    }

    const src = getVideoUrl(selected);

    if (!src) {
      setError("No playback URL is available for this video.");
      return;
    }

    setError(null);
    player.src({
      src,
      type: getVideoType(selected),
    });
  }, [selected]);

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "40px auto",
        padding: 16,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Video Stream Demo</h1>

      {loading && <p>Loading videos from NestJS…</p>}

      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      {videos.length > 0 && (
        <label style={{ display: "block", marginBottom: 16 }}>
          Select video{" "}
          <select
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setError(null);
            }}
          >
            {videos.map((video) => (
              <option key={video.id} value={video.id}>
                {video.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <div data-vjs-player>
        <div ref={containerRef} />
      </div>
    </main>
  );
}
