import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import videojs from "video.js";
import "video.js/dist/video-js.css";

import type { Interval, VideoProgress } from "../types/video";
import { getCurrentUserId } from "../config/demoUser";
import { getVideoById, updateVideo } from "../services/videoStorage";
import { getFile } from "../services/fileStorage";
import {
  emptyProgress,
  getProgress,
  saveProgress,
} from "../services/progressStorage";
import {
  COMPLETE_THRESHOLD,
  calcPercentage,
  calcXP,
  guessMimeFromUrl,
  mergeIntervals,
  sumIntervals,
} from "../utils/videoUtils";

type Player = ReturnType<typeof videojs>;

interface Stats {
  percentage: number;
  xp: number;
  maxXP: number;
}

// Holder object: TypeScript cannot narrow its properties to `never`
// when they are assigned inside async/closure code.
interface Session {
  player: Player | null;
  objectUrl: string | null;
  persist: (() => void) | null;
}

const MAX_STEP = 1.5; // seconds - bigger jumps between timeupdates are seeks, not watching
const SAVE_EVERY_MS = 5000;
const RESUME_GIVE_UP_MS = 10_000; // stop trying to resume after this long

/**
 * The DevTools guard is only active in production builds, so you can still
 * debug while developing. Set this to `true` to test the guard in `yarn dev`.
 */
const GUARD_ENABLED: boolean = import.meta.env.PROD;

/** Play mp4/webm links from a blob: URL so the original link is not in the page. */
const HIDE_LINK_WITH_BLOB = true;

/** Docked DevTools make the outer window noticeably bigger than the page. */
function isDevToolsDocked(): boolean {
  const widthGap = window.outerWidth - window.innerWidth > 160;
  const heightGap = window.outerHeight - window.innerHeight > 160;
  return widthGap || heightGap;
}

/** An open DevTools makes a `debugger` statement pause, which takes time. */
function isDebuggerPausing(): boolean {
  const start = performance.now();
  // Function constructor so bundlers/minifiers do not strip the statement
  new Function("debugger")();
  return performance.now() - start > 120;
}

/** Token must be written by VideoPortal within this many milliseconds. */
const TOKEN_MAX_AGE_MS = 15_000;

/** Same format that VideoPortal writes before opening the window. */
function writeToken(videoId: string): void {
  const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(`svp_token_${videoId}`, token);
}

/**
 * Validate and consume the one-time session token written by VideoPortal.
 * Call this only ONCE per window (see tokenRef) - React Strict Mode runs
 * effects twice in development.
 */
function consumeToken(videoId: string): boolean {
  const key = `svp_token_${videoId}`;
  const raw = localStorage.getItem(key);
  localStorage.removeItem(key);
  if (!raw) return false;
  const ts = parseInt(raw.split("_")[0], 10);
  return !Number.isNaN(ts) && Date.now() - ts <= TOKEN_MAX_AGE_MS;
}

export default function SecureVideoPlayer() {
  const { videoId } = useParams<{ videoId: string }>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  const startedRef = useRef(false);
  const tokenRef = useRef<{ videoId: string; ok: boolean } | null>(null);

  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  const startFullscreen = async () => {
    try {
      await pageRef.current?.requestFullscreen();
    } catch {
      setError(
        "Full screen was blocked by the browser. Please allow it and try again.",
      );
      return;
    }
    startedRef.current = true;
    setStarted(true);
    playerRef.current?.play();
  };

  const reloadWithToken = () => {
    if (videoId) writeToken(videoId);
    window.location.reload();
  };

  useEffect(() => {
    if (!videoId) {
      setError("No video selected.");
      setLoading(false);
      return;
    }

    // ── Token gate (runs the real check only once per window) ──────────────
    if (!tokenRef.current || tokenRef.current.videoId !== videoId) {
      tokenRef.current = { videoId, ok: consumeToken(videoId) };
    }
    if (!tokenRef.current.ok) {
      setLoading(false);
      setFinished(true);
      window.close();
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    let disposed = false;
    let locked = false;
    let resumeTimer: number | undefined;
    const session: Session = { player: null, objectUrl: null, persist: null };
    const userId = getCurrentUserId();

    /** Save progress, destroy the player and show the blocked screen. */
    const lock = (reason: string) => {
      if (locked) return;
      locked = true;
      disposed = true;
      session.persist?.();
      if (session.player && !session.player.isDisposed()) {
        session.player.pause();
        session.player.dispose();
      }
      session.player = null;
      playerRef.current = null;
      if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
      session.objectUrl = null;
      setBlocked(reason);
    };

    const init = async () => {
      const video = getVideoById(videoId);
      if (!video) {
        setError("This video no longer exists.");
        setLoading(false);
        return;
      }
      setTitle(video.topicName);

      // 1. resolve the playable source
      let src: string;
      let type: string;
      if (video.sourceType === "VIDEO_UPLOAD") {
        try {
          const blob = video.fileId ? await getFile(video.fileId) : null;
          if (!blob) {
            setError("The uploaded file could not be found in this browser.");
            setLoading(false);
            return;
          }
          session.objectUrl = URL.createObjectURL(blob);
        } catch {
          setError("Could not read the uploaded file from browser storage.");
          setLoading(false);
          return;
        }
        src = session.objectUrl;
        type = video.mimeType || "video/mp4";
      } else {
        if (!video.sourceUrl) {
          setError("This video has no source.");
          setLoading(false);
          return;
        }
        src = video.sourceUrl;
        type = guessMimeFromUrl(video.sourceUrl);

        // Hide the original link: download the file and play it from a blob: URL.
        // Not possible for HLS/DASH (many segments) or when the host blocks CORS.
        const isStream =
          type === "application/x-mpegURL" || type === "application/dash+xml";
        if (HIDE_LINK_WITH_BLOB && !isStream) {
          try {
            const res = await fetch(video.sourceUrl, {
              credentials: "omit",
              referrerPolicy: "no-referrer",
            });
            if (res.ok) {
              const blob = await res.blob();
              if (!disposed) {
                session.objectUrl = URL.createObjectURL(blob);
                src = session.objectUrl;
              }
            }
          } catch {
            /* CORS or network problem: fall back to the direct link */
          }
        }
      }

      const container = containerRef.current;
      if (disposed || !container) {
        if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
        session.objectUrl = null;
        return;
      }

      // 2. load this student's saved progress
      const saved =
        getProgress(userId, video.id) ?? emptyProgress(userId, video.id);
      let intervals: Interval[] = mergeIntervals(saved.watchedIntervals);
      let duration = video.durationSeconds; // may be 0 for HLS links
      let lastTime: number | null = null;
      let lastSave = 0;

      // FIX: resume state. While `resumePending` is true we keep the OLD saved
      // position (never overwrite it with 0) and do not count watched time.
      const resumeTarget = saved.lastPositionSeconds;
      let resumePending = resumeTarget > 1;

      // 3. create the Video.js player (standard pattern, not @videojs/react)
      const el = document.createElement("video");
      el.className = "video-js vjs-big-play-centered";
      el.setAttribute("playsinline", "");
      el.setAttribute("controlsList", "nodownload noremoteplayback");
      el.setAttribute("disablePictureInPicture", "");
      el.setAttribute("oncontextmenu", "return false");
      container.appendChild(el);

      // `player` is a const, so it is never null inside the callbacks below
      const player: Player = videojs(el, {
        controls: true,
        fill: true,
        preload: "auto",
        controlBar: { pictureInPictureToggle: false, fullscreenToggle: false },
      });
      session.player = player;
      playerRef.current = player;
      setLoading(false);

      const buildProgress = (position: number): VideoProgress => {
        const merged = mergeIntervals(intervals);
        const watched = sumIntervals(merged);
        const pct = calcPercentage(watched, duration);
        return {
          userId,
          videoId: video.id,
          watchedIntervals: merged,
          watchedSeconds: Math.round(watched),
          watchPercentage: Math.round(pct * 10) / 10,
          earnedXP: calcXP(video.maxXP, pct),
          completed: pct >= COMPLETE_THRESHOLD,
          lastPositionSeconds: position,
          updatedAt: new Date().toISOString(),
        };
      };

      session.persist = () => {
        if (player.isDisposed()) return;
        intervals = mergeIntervals(intervals);
        // FIX: do not overwrite the saved position with 0 before resume is done
        const position = resumePending
          ? resumeTarget
          : (player.currentTime() ?? 0);
        const progress = buildProgress(position);
        saveProgress(progress);
        setStats({
          percentage: progress.watchPercentage,
          xp: progress.earnedXP,
          maxXP: video.maxXP,
        });
      };

      /** Read the real duration (HLS reports it late) and store it. */
      const syncDuration = () => {
        const d = player.duration();
        if (typeof d === "number" && Number.isFinite(d) && d > 0) {
          if (Math.abs(d - duration) > 1) {
            duration = d;
            try {
              updateVideo(video.id, { durationSeconds: d });
            } catch {
              /* ignore */
            }
          }
        }
      };

      /** Try to jump to the saved position; called on several events. */
      const tryResume = () => {
        if (!resumePending || player.isDisposed()) return;
        syncDuration();

        // saved position is (almost) the end -> start from the beginning
        if (duration > 0 && resumeTarget >= duration - 2) {
          resumePending = false;
          return;
        }

        // wait until the stream is seekable up to the target
        const seekable = player.seekable();
        const canSeek =
          seekable &&
          seekable.length > 0 &&
          seekable.end(seekable.length - 1) >= resumeTarget;
        if (!canSeek || player.seeking()) return;

        player.currentTime(resumeTarget);
      };

      player.src({ src, type });

      // give up after a while so a bad stream can never block progress counting
      resumeTimer = window.setTimeout(() => {
        resumePending = false;
      }, RESUME_GIVE_UP_MS);

      player.on("loadedmetadata", () => {
        syncDuration();
        tryResume();
        session.persist?.();
      });
      player.on("durationchange", () => {
        syncDuration();
        tryResume();
      });
      player.on("loadeddata", tryResume);
      player.on("canplay", tryResume);
      player.on("progress", tryResume);

      player.on("play", () => {
        tryResume();
        lastTime = player.currentTime() ?? null;
      });

      player.on("timeupdate", () => {
        if (player.paused() || player.seeking()) return;
        if (resumePending) {
          tryResume();
          lastTime = null;
          return; // do not count time before resume is done
        }
        const cur = player.currentTime() ?? 0;
        if (lastTime !== null) {
          const delta = cur - lastTime;
          // only count smooth forward playback - a jump (seek) counts as nothing
          if (delta > 0 && delta <= MAX_STEP) {
            intervals.push([lastTime, cur]);
          }
        }
        lastTime = cur;

        const now = Date.now();
        if (now - lastSave >= SAVE_EVERY_MS) {
          lastSave = now;
          session.persist?.();
        }
      });

      player.on("seeking", () => {
        lastTime = null;
      });
      player.on("seeked", () => {
        const cur = player.currentTime() ?? 0;
        // resume finished once we are close to the saved position
        if (resumePending && Math.abs(cur - resumeTarget) < 2) {
          resumePending = false;
        }
        lastTime = cur;
      });
      player.on("pause", () => session.persist?.());
      player.on("ended", () => {
        session.persist?.();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        }
      });
      player.on("error", () => {
        setError(
          "The video could not be played. Check the link or file format.",
        );
      });
    };

    init();

    // ---- deterrents (they slow people down; they cannot fully prevent copying) ----
    const onHide = () => session.persist?.();

    const endSession = () => {
      session.persist?.();
      if (session.player && !session.player.isDisposed())
        session.player.pause();
      setFinished(true);
      window.close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const devToolsKey =
        e.key === "F12" ||
        (mod && e.shiftKey && ["i", "j", "c", "k"].includes(key)) ||
        (e.metaKey && e.altKey && ["i", "j", "c"].includes(key)); // macOS
      const otherBlocked = mod && ["u", "s", "p"].includes(key);

      // Address-bar focus shortcuts - trying to grab the URL ends the session
      const addressBarKey =
        (mod && key === "l") || // Ctrl/Cmd+L
        e.key === "F6" || // F6 (Chromium)
        (e.altKey && key === "d"); // Alt+D (Windows)

      if (devToolsKey || otherBlocked || addressBarKey) {
        e.preventDefault();
        e.stopPropagation();
        if (GUARD_ENABLED && devToolsKey)
          lock("Developer tools are not allowed.");
        if (addressBarKey) endSession();
      }
    };

    /** End the session whenever the user copies anything (including the URL). */
    const onCopy = () => endSession();

    const stopEvent = (e: Event) => e.preventDefault();

    let guardTimer: number | undefined;
    if (GUARD_ENABLED) {
      guardTimer = window.setInterval(() => {
        if (isDevToolsDocked() || isDebuggerPausing()) {
          lock("Developer tools were detected.");
        }
      }, 1000);
    }

    const onFullscreenChange = () => {
      if (!document.fullscreenElement && startedRef.current) endSession();
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("contextmenu", stopEvent);
    window.addEventListener("dragstart", stopEvent);
    document.addEventListener("copy", onCopy, true);

    return () => {
      disposed = true;
      if (guardTimer) window.clearInterval(guardTimer);
      if (resumeTimer) window.clearTimeout(resumeTimer);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", stopEvent);
      window.removeEventListener("dragstart", stopEvent);
      document.removeEventListener("copy", onCopy, true);
      session.persist?.();
      if (session.player && !session.player.isDisposed())
        session.player.dispose();
      session.player = null;
      playerRef.current = null;
      if (session.objectUrl) URL.revokeObjectURL(session.objectUrl);
      session.objectUrl = null;
    };
  }, [videoId]);

  return (
    <div className="player-page" ref={pageRef}>
      <header className="player-header">
        <strong>{title || "Video"}</strong>
        {stats && (
          <span>
            Watched {Math.round(stats.percentage)}% · XP {stats.xp} /{" "}
            {stats.maxXP}
          </span>
        )}
        <button onClick={() => window.close()}>Close</button>
      </header>

      {finished ? (
        <div className="player-error">
          <p className="msg ok">Session ended. Your progress was saved.</p>
          <p>You can close this window.</p>
        </div>
      ) : blocked ? (
        <div className="player-error">
          <p className="msg error">{blocked}</p>
          <p>
            Your progress was saved. Close the developer tools, then reload to
            continue watching.
          </p>
          <button onClick={reloadWithToken}>Reload</button>
        </div>
      ) : error ? (
        <p className="msg error player-error">{error}</p>
      ) : (
        <>
          {loading && <p className="player-error">Loading video…</p>}
          <div
            ref={containerRef}
            className="player-stage"
            onContextMenu={(e) => e.preventDefault()}
          />
          {!started && !loading && (
            <div className="start-overlay">
              <button onClick={startFullscreen}>▶ Start in full screen</button>
              <p>
                Leaving full screen will end the session and close this window.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
