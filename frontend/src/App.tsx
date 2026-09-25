import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminPortalPage } from './pages/AdminPortalPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { PatientPortalPage } from './pages/PatientPortalPage.tsx';
import { StaffPortalPage } from './pages/StaffPortalPage.tsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/patient" element={<PatientPortalPage />} />
      <Route path="/staff" element={<StaffPortalPage />} />
      <Route path="/admin" element={<AdminPortalPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
