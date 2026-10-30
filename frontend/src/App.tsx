import {
  NavLink,
  Outlet,
  RouterProvider,
  createBrowserRouter,
} from "react-router-dom";
import VideoPortal from "./pages/VideoPortal";
import VideoUpload from "./pages/VideoUpload";
import SecureVideoPlayer from "./pages/SecureVideoPlayer";
import VideoStream from "./pages/VideoStream";
import "./styles.css";

export function Layout() {
  return (
    <>
      <nav className="nav">
        <NavLink to="/" end>
          Portal
        </NavLink>
        <NavLink to="/admin">Admin</NavLink>
        <NavLink to="/video-stream-demo">Video Stream</NavLink>
      </nav>

      <main className="container">
        <Outlet />
      </main>
    </>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        index: true,
        element: <VideoPortal />,
      },
      {
        path: "admin",
        element: <VideoUpload />,
      },
      {
        path: "video-stream-demo",
        element: <VideoStream />,
      },
      {
        path: "*",
        element: <p>Page not found.</p>,
      },
    ],
  },
  {
    path: "/player/:videoId",
    element: <SecureVideoPlayer />,
  },
]);

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
    </>
  );
}
