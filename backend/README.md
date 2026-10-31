# Video Streaming Backend

NestJS backend microservice powering adaptive HLS video streaming, secure session management, and on-the-fly virtual segment remuxing for local and remote video sources.

## Features

- **Virtual On-the-Fly HLS Streaming**: Local MP4 files are remuxed to MPEG-TS chunks on-the-fly via FFmpeg copy mode with zero transcoding overhead and sub-second seek times.
- **External Stream Caching**: Pre-processes and caches remote streams (MP4/M3U8) on-demand to serve TS segments efficiently.
- **Secure Playback Sessions**: Issues cryptographically secure session tokens in HTTP-only cookies with automatic TTL expiration.
- **Directory Traversal Protection**: Strict validation and sanitization of file paths and video directories.
- **Safe Process Lifecycle**: Graceful shutdown and process cleanup for spawned FFmpeg instances without zombie workers or memory leaks.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check endpoint returning status and current timestamp |
| `GET` / `POST` | `/api/video-stream/videos` | List available video items (`id`, `title`, `sourceType`) |
| `POST` | `/api/video-stream/session/:id` | Create a playback session for video `id` and set HTTP-only cookie |
| `GET` | `/api/video-stream/stream/:id/playlist.m3u8` | Fetch HLS playlist (M3U8) for the authorized session |
| `GET` | `/api/video-stream/stream/:id/segment_:index.ts` | Fetch MPEG-TS segment for playback |

## Project Setup

```bash
# Install dependencies
yarn install
```

## Running the Application

```bash
# Development mode
yarn run start:dev

# Production build & start
yarn run build
yarn run start:prod
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port for the NestJS server |
| `FRONTEND_URL` | `http://localhost:5173` | Allowed CORS origin for frontend |
| `ENABLE_STARTUP_PREWARM` | `false` | When `true`, pre-warms external stream cache on server boot |

## Testing & Quality

```bash
# Run unit tests
yarn run test

# Run end-to-end tests
yarn run test:e2e

# Run linter
yarn run lint

# Format code
yarn run format
```
