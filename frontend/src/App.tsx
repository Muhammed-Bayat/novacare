import { useAuth0 } from '@auth0/auth0-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminPortalPage } from './pages/AdminPortalPage.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { PatientPortalPage } from './pages/PatientPortalPage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { StaffPortalPage } from './pages/StaffPortalPage.tsx';

function HomeRoute() {
  const { isAuthenticated } = useAuth0();
  // Auth0 returns the authorization code to the site root, so keep the marketing
  // page out of the way while the SDK exchanges it.
  const handlingAuthRedirect = new URLSearchParams(window.location.search).has('code');
  return isAuthenticated || handlingAuthRedirect ? <SignInPage /> : <LandingPage />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/patient" element={<PatientPortalPage />} />
      <Route path="/staff" element={<StaffPortalPage />} />
      <Route path="/admin" element={<AdminPortalPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
