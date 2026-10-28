import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import VideoPortal from "./pages/VideoPortal";
import VideoUpload from "./pages/VideoUpload";
import SecureVideoPlayer from "./pages/SecureVideoPlayer";
import VideoStream from "./pages/VideoStream";
import "./styles.css";

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="nav">
        <NavLink to="/" end>
          Portal
        </NavLink>
        <NavLink to="/admin">Admin</NavLink>
        <NavLink to="/video-stream-demo">video stream</NavLink>
      </nav>
      <main className="container">{children}</main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/player/:videoId" element={<SecureVideoPlayer />} />
        <Route
          path="/"
          element={
            <Layout>
              <VideoPortal />
            </Layout>
          }
        />
        <Route
          path="/admin"
          element={
            <Layout>
              <VideoUpload />
            </Layout>
          }
        />
        <Route
          path="/video-stream-demo"
          element={
            <Layout>
              <VideoStream />
            </Layout>
          }
        />
        <Route
          path="*"
          element={
            <Layout>
              <p>Page not found.</p>
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
