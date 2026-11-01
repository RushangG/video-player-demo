import { useState } from "react";

export function VideoUrlToChunk() {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoTopic, setVideoTopic] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!videoUrl || !videoTopic.trim().length) return alert("Please enter a video link or topic name");

    setLoading(true);
    setStatus("Processing video on backend...");

    try {
      const response = await fetch(
        "http://localhost:3000/api/video-stream/process",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: videoUrl, title: videoTopic }),
        },
      );

      const data = await response.json();
      console.log(data);
      if (data.status === "success") {
        setStatus("Success! Video chunks saved in backend.");
      } else if (data.status === "skipped") {
        setStatus("Skipped ! video chunk already exist for this url.");
      } else {
        setStatus(`Error: ${data.message}`);
      }
    } catch (error) {
      setStatus("Failed to connect to the backend server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "2rem", fontFamily: "Arial" }}>
      <h2>Video Link Chunking System</h2>
      <form onSubmit={handleSubmit}>
        <label htmlFor="topic">Enter Topic Name:</label>
        <input
          type="text"
          id="topic"
          placeholder="Enter Video Topic Name (e.g., HTML-CSS)"
          value={videoTopic}
          onChange={(e) => setVideoTopic(e.target.value)}
          style={{ width: "400px", padding: "8px", marginRight: "10px" }}
          disabled={loading}
        />
        <br />
        <label htmlFor="videoUrl">Video URl:</label>
        <input
          type="text"
          id="videoUrl"
          placeholder="Paste video link here (e.g., direct mp4 url)"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          style={{ width: "400px", padding: "8px", marginRight: "10px" }}
          disabled={loading}
        />

        <button type="submit" disabled={loading}>
          {loading ? "Processing..." : "Submit Link"}
        </button>
      </form>
      {status && (
        <p style={{ marginTop: "15px", fontWeight: "bold" }}>{status}</p>
      )}
    </div>
  );
}
