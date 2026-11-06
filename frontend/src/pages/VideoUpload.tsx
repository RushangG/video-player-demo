import { useState } from "react";
import type { ChangeEvent } from "react";
import type { VideoData, VideoSourceType } from "../types/video";
import { deleteVideo, getVideos, saveVideo } from "../services/videoStorage";
import { deleteFile, saveFile } from "../services/fileStorage";
import { formatTime, readVideoDuration } from "../utils/videoUtils";

export default function VideoUpload() {
  const [topicName, setTopicName] = useState("");
  const [xp, setXP] = useState("10");
  const [sourceType, setSourceType] = useState<VideoSourceType>("VIDEO_LINK");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [videos, setVideos] = useState(() => getVideos());

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
  };

  const validate = (): string | null => {
    if (!topicName.trim()) return "Enter a topic name.";
    const xpNumber = Number(xp);
    if (!Number.isFinite(xpNumber) || xpNumber <= 0)
      return "XP must be greater than 0.";
    if (sourceType === "VIDEO_LINK") {
      try {
        const u = new URL(link.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:")
          throw new Error();
      } catch {
        return "Enter a valid http(s) video link.";
      }
    } else if (!file) {
      return "Choose a video file.";
    }
    return null;
  };

  const handleSubmit = async () => {
    setError(null);
    setMessage(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    const id = crypto.randomUUID();
    let savedFileId: string | undefined;

    try {
      let durationSeconds = 0;
      let note = "";
      const base = {
        id,
        topicName: topicName.trim(),
        maxXP: Number(xp),
        createdAt: new Date().toISOString(),
      };
      let video: VideoData;

      if (sourceType === "VIDEO_UPLOAD" && file) {
        const tempUrl = URL.createObjectURL(file);
        try {
          durationSeconds = await readVideoDuration(tempUrl);
        } finally {
          URL.revokeObjectURL(tempUrl);
        }
        savedFileId = crypto.randomUUID();
        await saveFile(savedFileId, file);
        video = {
          ...base,
          sourceType,
          fileId: savedFileId,
          mimeType: file.type || "video/mp4",
          durationSeconds,
        };
      } else {
        try {
          durationSeconds = await readVideoDuration(link.trim());
        } catch {
          note =
            " Duration could not be read now; it will be detected on first play.";
        }
        video = {
          ...base,
          sourceType,
          sourceUrl: link.trim(),
          durationSeconds,
        };
      }

      saveVideo(video);
      setVideos(getVideos());
      setMessage(`Saved "${video.topicName}".${note}`);
      setTopicName("");
      setLink("");
      setFile(null);
    } catch (err) {
      if (savedFileId) deleteFile(savedFileId).catch(() => undefined);
      setError(
        err instanceof Error
          ? `Could not save the video: ${err.message}`
          : "Could not save the video (storage may be full).",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this video and all student progress for it?"))
      return;
    await deleteVideo(id);
    setVideos(getVideos());
  };

  return (
    <div className="card">
      <h2>Add video</h2>

      <div className="field">
        <label htmlFor="topic">Topic name</label>
        <input
          id="topic"
          type="text"
          value={topicName}
          onChange={(e) => setTopicName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="xp">Maximum XP</label>
        <input
          id="xp"
          type="number"
          min={1}
          value={xp}
          onChange={(e) => setXP(e.target.value)}
        />
      </div>

      <div className="field">
        <label>
          <input
            type="radio"
            name="source"
            checked={sourceType === "VIDEO_LINK"}
            onChange={() => setSourceType("VIDEO_LINK")}
          />{" "}
          Video link
        </label>{" "}
        <label>
          <input
            type="radio"
            name="source"
            checked={sourceType === "VIDEO_UPLOAD"}
            onChange={() => setSourceType("VIDEO_UPLOAD")}
          />{" "}
          Upload file
        </label>
      </div>

      {sourceType === "VIDEO_LINK" ? (
        <div className="field">
          <label htmlFor="link">Video URL (mp4)</label>
          <input
            id="link"
            type="url"
            placeholder="https://example.com/video.mp4"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="file">Video file</label>
          <input id="file" type="file" accept="video/*" onChange={handleFile} />
          {file && <small>{file.name}</small>}
        </div>
      )}

      <button onClick={handleSubmit} disabled={busy}>
        {busy ? "Saving…" : "Save video"}
      </button>

      {error && <p className="msg error">{error}</p>}
      {message && <p className="msg ok">{message}</p>}

      <h3>Saved videos</h3>
      {videos.length === 0 ? (
        <p className="muted">No videos yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Topic</th>
              <th>Source</th>
              <th>Duration</th>
              <th>XP</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {videos.map((v, i) => (
              <tr key={v.id}>
                <td>{i + 1}</td>
                <td>{v.topicName}</td>
                <td>
                  {v.sourceType === "VIDEO_UPLOAD" ? "Uploaded file" : "Link"}
                </td>
                <td>
                  {v.durationSeconds ? formatTime(v.durationSeconds) : "—"}
                </td>
                <td>{v.maxXP}</td>
                <td>
                  <button className="danger" onClick={() => handleDelete(v.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
