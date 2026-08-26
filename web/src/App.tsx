import { Route, Routes } from "react-router";

import LandingPage from "@/routes/landing";
import OfflinePage from "@/routes/offline";
import Login from "@/routes/auth/Login";
import Signup from "@/routes/auth/Signup";
import Verify from "@/routes/auth/Verify";
import ForgotPassword from "@/routes/auth/ForgotPassword";
import ResetPassword from "@/routes/auth/ResetPassword";
import { RequireAuth } from "@/auth/RequireAuth";
import { AppLayout } from "@/app/AppLayout";
import Home from "@/app/screens/Home";
import Sessions from "@/app/screens/Sessions";
import SessionDetail from "@/app/screens/SessionDetail";
import Watchers from "@/app/screens/Watchers";
import Agents from "@/app/screens/Agents";
import Profile from "@/app/screens/Profile";

export default function App() {
  return (
    <Routes>
      {/* Marketing */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/offline" element={<OfflinePage />} />

      {/* Auth */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Product. Same origin as the marketing site, so /api/** can rewrite to
          Cloud Run without CORS — but a separate shell, and the only place a
          service worker is registered. RequireAuth is bypassed on localhost. */}
      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="agents" element={<Agents />} />
          <Route path="sessions/:id" element={<SessionDetail />} />
          <Route path="watchers" element={<Watchers />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Route>
    </Routes>
  );
}
