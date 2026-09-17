import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router';
import { ApiError } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { ConfigProvider } from './lib/config';
import { ToastProvider } from './lib/toast';
import { MapProvider } from './map/MapProvider';
import { MapShell } from './map/MapShell';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SignInPage } from './pages/SignInPage';
import { CoveragePanel } from './planner/CoveragePanel';
import { DirectionsPanel } from './planner/DirectionsPanel';
import { DiscoverPanel } from './planner/DiscoverPanel';
import { PlannerProvider } from './planner/PlannerState';
import { RoundTripPanel } from './planner/RoundTripPanel';
import { SettingsPanel } from './planner/SettingsPanel';
import { TripDetailPanel } from './planner/TripDetailPanel';
import { TripsPanel } from './planner/TripsPanel';

const AdminApp = lazy(() => import('./admin/AdminApp'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function Boot() {
  return (
    <div className="boot" role="status">
      <span className="spinner" aria-label="Loading" />
    </div>
  );
}

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Boot />;
  if (status === 'anonymous') return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function RedirectIfAuthed() {
  const { status } = useAuth();
  if (status === 'loading') return <Boot />;
  if (status === 'authenticated') return <Navigate to="/directions" replace />;
  return <Outlet />;
}

function RequireStaff() {
  const { user } = useAuth();
  if (!user || user.role === 'user') return <Navigate to="/directions" replace />;
  return (
    <Suspense fallback={<Boot />}>
      <Outlet />
    </Suspense>
  );
}

function PlannerLayout() {
  return (
    <PlannerProvider>
      <MapProvider>
        <MapShell />
      </MapProvider>
    </PlannerProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <PlannerLayout />,
        children: [
          { index: true, element: <Navigate to="/directions" replace /> },
          { path: '/directions', element: <DirectionsPanel /> },
          { path: '/loop', element: <RoundTripPanel /> },
          { path: '/discover', element: <DiscoverPanel /> },
          { path: '/coverage', element: <CoveragePanel /> },
          { path: '/trips', element: <TripsPanel /> },
          { path: '/trips/:id', element: <TripDetailPanel /> },
          { path: '/settings', element: <SettingsPanel /> },
        ],
      },
      {
        element: <RequireStaff />,
        children: [{ path: '/admin/*', element: <AdminApp /> }],
      },
    ],
  },
  { path: '*', element: <Navigate to="/directions" replace /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <AuthProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthProvider>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
