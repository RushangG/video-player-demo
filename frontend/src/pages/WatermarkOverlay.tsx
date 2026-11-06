import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getCurrentUserId } from "../config/demoUser";

export interface WatermarkOverlayProps {
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

export default function WatermarkOverlay({
  position = "bottom-right",
}: WatermarkOverlayProps = {}) {
  const { videoId } = useParams<{ videoId: string }>();
  const [tamperKey, setTamperKey] = useState(0);
  const watermarkRef = useRef<HTMLDivElement | null>(null);

  const userId = getCurrentUserId();

  useEffect(() => {
    const el = watermarkRef.current;
    if (!el || !el.parentElement) return;

    const parent = el.parentElement;

    // Detect attempts to hide the watermark via inline styles or classes
    const elementObserver = new MutationObserver(() => {
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        parseFloat(style.opacity || "1") < 0.05
      ) {
        setTamperKey((k) => k + 1);
      }
    });

    elementObserver.observe(el, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });

    // Detect removal of the watermark from the DOM
    const parentObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const removedNode of Array.from(m.removedNodes)) {
          if (
            removedNode === el ||
            (removedNode instanceof HTMLElement && removedNode.contains(el))
          ) {
            setTamperKey((k) => k + 1);
          }
        }
      }
    });

    parentObserver.observe(parent, { childList: true });

    return () => {
      elementObserver.disconnect();
      parentObserver.disconnect();
    };
  }, [tamperKey]);

  return (
    <div
      key={tamperKey}
      ref={watermarkRef}
      className={`video-watermark video-watermark-${position}`}
      data-video-id={videoId}
      aria-hidden="true"
    >
      <span className="video-watermark-text">{userId}</span>
    </div>
  );
}
