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

  // Progress tracking states
  const [currentPercent, setCurrentPercent] = useState<number>(0);
  const [highestPercent, setHighestPercent] = useState<number>(0);

  useEffect(() => {
    axios
      .post<VideoItem[]>(`${API}/videos`)
      .then(({ data }) => {
        setVideos(data);
        if (data.length) setSelectedId(data[0].id);
      })
      .catch(() => setError("Unable to load videos"));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const element = document.createElement("video-js");
    element.classList.add("vjs-big-play-centered");
    containerRef.current.appendChild(element);

    const player = videojs(element, {
      controls: true,
      responsive: true,
      fluid: true,
      preload: "auto",
      controlBar: { pictureInPictureToggle: false },
      html5: {
        vhs: {
          withCredentials: true,
          goalBufferLength: 45,
          maxGoalBufferLength: 90,
          bufferLowWaterLine: 15,
          experimentalBufferBasedABR: true,
          fastStart: true,
          smoothQualityChange: true,
          liveui: false,
        },
      },
    });

    player.on("timeupdate", () => {
      const currentTime = player.currentTime() || 0;
      const duration = player.duration() || 0;

      if (duration > 0) {
        const percentage = Math.floor((currentTime / duration) * 100);

        setCurrentPercent(percentage);

        setHighestPercent((prevHighest) => {
          const nextHighest =
            percentage > prevHighest ? percentage : prevHighest;

          return nextHighest;
        });
      }
    });

    player.on("waiting", () => {
      const currentTech = player.tech({
        IWillNotUseThisInAppCode: true,
      }) as { vhs?: { bufferLength_: number } } | undefined;

      if (currentTech && currentTech.vhs && currentTech.vhs.bufferLength_ > 0) {
        const time = player.currentTime() || 0;
        player.currentTime(time + 0.1);
      }
    });

    playerRef.current = player;

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !selectedId) return;

    let cancelled = false;

    async function playVideo() {
      try {
        setError("");

        setCurrentPercent(0);
        setHighestPercent(0);

        player?.reset();

        await axios.post(
          `${API}/session/${encodeURIComponent(selectedId)}`,
          {},
          { withCredentials: true },
        );

        if (cancelled) return;

        player?.src({
          src: `${API}/stream/${encodeURIComponent(selectedId)}/playlist.m3u8`,
          type: "application/x-mpegURL",
        });

        player?.load();

        const playPromise = player?.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            console.log("Autoplay blocked. Awaiting user interaction.");
          });
        }
      } catch (err) {
        console.error("Playback startup error:", err);
        if (!cancelled) setError("Unable to start video. Please try again.");
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

      <label style={{ fontWeight: "bold" }}>
        Select video:{" "}
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{
            padding: "6px 12px",
            marginLeft: 8,
            fontSize: "16px",
            borderRadius: "4px",
          }}
        >
          {videos.map((video) => (
            <option key={video.id} value={video.id}>
              {video.title}
            </option>
          ))}
        </select>
      </label>

      <div
        style={{
          marginTop: 15,
          padding: 12,
          background: "#f0f0f0",
          borderRadius: 4,
        }}
      >
        Progress Tracking: Current Position: <strong>{currentPercent}%</strong>{" "}
        | Total Viewed: <strong>{highestPercent}% / 100%</strong>
      </div>

      {error && (
        <p role="alert" style={{ color: "crimson", marginTop: 12 }}>
          {error}
        </p>
      )}

      <div
        style={{
          marginTop: 20,
          background: "#000",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <div ref={containerRef} />
      </div>
    </main>
  );
}
