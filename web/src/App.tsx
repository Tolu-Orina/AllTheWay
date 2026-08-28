import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useParams, useSearchParams } from "react-router";

import { RequireAuth } from "@/auth/RequireAuth";
import { RouteFallback } from "@/app/RouteFallback";

/**
 * Routes, split so a page only downloads what it needs.
 *
 * ## Why every import here is lazy
 *
 * They were all static, which put the marketing page, every auth screen and all
 * six app screens into one 786KB bundle — 236KB gzipped, parsed before anything
 * became interactive. Someone opening `/login` on a phone downloaded the entire
 * product, including Firebase and the animation library, to see an email field.
 *
 * The landing page is lazy too. It is what a first-time visitor loads, and it
 * has no reason to carry the signed-in app with it.
 *
 * `AppLayout` stays split from its children so the shell paints while a screen
 * arrives, rather than the whole authenticated area waiting on one chunk.
 */

const LandingPage = lazy(() => import("@/routes/landing"));
const ContactPage = lazy(() => import("@/routes/contact"));
const PrivacyPage = lazy(() => import("@/routes/privacy"));
const OfflinePage = lazy(() => import("@/routes/offline"));

const Login = lazy(() => import("@/routes/auth/Login"));
const Signup = lazy(() => import("@/routes/auth/Signup"));
const Verify = lazy(() => import("@/routes/auth/Verify"));
const ForgotPassword = lazy(() => import("@/routes/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("@/routes/auth/ResetPassword"));

const AppLayout = lazy(() =>
  import("@/app/AppLayout").then((m) => ({ default: m.AppLayout })),
);
const Home = lazy(() => import("@/app/screens/Home"));
const Sessions = lazy(() => import("@/app/screens/Sessions"));
const SessionDetail = lazy(() => import("@/app/screens/SessionDetail"));
const Watchers = lazy(() => import("@/app/screens/Watchers"));
const Agents = lazy(() => import("@/app/screens/Agents"));
const Profile = lazy(() => import("@/app/screens/Profile"));
const ArtifactScreen = lazy(() =>
  import("@/app/Canvas").then((m) => ({ default: m.ArtifactScreen })),
);

/**
 * Auth guard and the signed-in shell share one catalogue. RequireAuth calls
 * `useT` for the session check; wrapping only AppLayout left that call
 * outside the provider, so /app threw before Home could ask the job.
 */
// The provider now lives in main.tsx, above App: the auth screens call `useT`
// too, and they render outside this subtree.

/**
 * Old bookmarks keep working. Query strings travel with them — `?fail=` in
 * tests and `?connected=` after Google both used to live on the retired paths.
 */
function RedirectKeepQuery({ to }: { to: string }) {
  const [params] = useSearchParams();
  const q = params.toString();
  return <Navigate to={q ? `${to}?${q}` : to} replace />;
}

function RedirectSessionToWork() {
  const { id = "" } = useParams();
  return <RedirectKeepQuery to={`/app/work/${id}`} />;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/offline" element={<OfflinePage />} />

        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<RequireAuth />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="work" element={<Sessions />} />
            <Route path="work/:id" element={<SessionDetail />} />
            <Route path="watchers" element={<Watchers />} />
            <Route path="you" element={<Profile />} />
            <Route path="you/running" element={<Agents />} />
            <Route path="artifacts/:id" element={<ArtifactScreen />} />

            <Route path="sessions" element={<RedirectKeepQuery to="/app/work" />} />
            <Route path="sessions/:id" element={<RedirectSessionToWork />} />
            <Route path="profile" element={<RedirectKeepQuery to="/app/you" />} />
            <Route path="agents" element={<RedirectKeepQuery to="/app/you/running" />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
