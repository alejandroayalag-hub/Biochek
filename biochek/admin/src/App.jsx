import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EmpleadosPage from './pages/EmpleadosPage';
import SedesPage from './pages/SedesPage';
import EnrolamientosPage from './pages/EnrolamientosPage';
import ReportesPage from './pages/ReportesPage';
import DispositivosStubPage from './pages/DispositivosStubPage';
import ExportacionesNoiPage from './pages/ExportacionesNoiPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="empleados" element={<EmpleadosPage />} />
          <Route path="sedes" element={<SedesPage />} />
          <Route path="enrolamientos" element={<EnrolamientosPage />} />
          <Route path="reportes" element={<ReportesPage />} />
          <Route path="dispositivos" element={<DispositivosStubPage />} />
          <Route path="exportacion-noi" element={<ExportacionesNoiPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
