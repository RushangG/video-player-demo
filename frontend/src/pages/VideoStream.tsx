import { useEffect, useRef, useState } from "react";
import axios from "axios";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";

const API = "http://localhost:3000/api/video-stream";

type VideoItem = {
  id: string;
  title: string;
  sourceType: "local" | "external";
};

export default function VideoStream() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  // 1. Load the video list using POST.
  useEffect(() => {
    axios
      .post<VideoItem[]>(`${API}/videos`)
      .then(({ data }) => {
        setVideos(data);

        if (data.length) {
          setSelectedId(data[0].id);
        }
      })
      .catch(() => setError("Unable to load videos"));
  }, []);

  // 2. Create the Video.js player once.
  useEffect(() => {
    if (!containerRef.current) return;

    const element = document.createElement("video-js");
    element.classList.add("vjs-big-play-centered");
    containerRef.current.appendChild(element);

    // React Frontend: VideoStream.tsx
    const player = videojs(element, {
      controls: true,
      responsive: true,
      fluid: true,
      preload: "auto",
      controlBar: {
        pictureInPictureToggle: false,
      },
      html5: {
        vhs: {
          withCredentials: true,

          goalBufferLength: 45,
          maxGoalBufferLength: 90,
          bufferLowWaterLine: 15,
        },
      },
    });

    playerRef.current = player;

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  // 3. Request a session and start the selected video.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !selectedId) return;

    let cancelled = false;

    async function playVideo() {
      try {
        setError("");

        // 1. Reset player state before fetching the new video to avoid playlist collisions
        player?.reset();

        await axios.post(
          `${API}/session/${encodeURIComponent(selectedId)}`,
          {},
          { withCredentials: true },
        );

        if (cancelled) return;

        // 2. Load the dynamic HLS playlist path
        player?.src({
          src: `${API}/stream/${encodeURIComponent(selectedId)}/playlist.m3u8`,
          type: "application/x-mpegURL",
        });

        player?.load();

        // 3. Auto-play the video as soon as the manifest is fetched
        player?.play()?.catch(() => {
          console.log("User interaction required before autoplay can begin.");
        });
      } catch (error) {
        console.error("Video playback error:", error);
        if (!cancelled) {
          setError("Unable to start video. Please try again.");
        }
      }
    }

    void playVideo();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: 16,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Video Streaming Demo</h1>

      <label>
        Select video:{" "}
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {videos.map((video) => (
            <option key={video.id} value={video.id}>
              {video.title} ({video.sourceType})
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}

      <div style={{ marginTop: 20 }}>
        <div ref={containerRef} />
      </div>
    </main>
  );
}
