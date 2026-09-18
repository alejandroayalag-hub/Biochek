import { useEffect, useState } from 'react';
import api from '../api/client';

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfTodayISO() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ empleadosActivos: null, enrolamientosPendientes: null, checadasHoy: null });

  useEffect(() => {
    async function load() {
      const [empleados, enrolamientos, checadas] = await Promise.all([
        api.get('/empleados'),
        api.get('/enrolamientos', { params: { estado: 'pendiente' } }),
        api.get('/checadas', { params: { desde: startOfTodayISO(), hasta: endOfTodayISO() } }),
      ]);
      setStats({
        empleadosActivos: empleados.data.filter((e) => e.estado === 'activo').length,
        enrolamientosPendientes: enrolamientos.data.length,
        checadasHoy: checadas.data.length,
      });
    }
    load();
  }, []);

  const cards = [
    { label: 'Empleados activos', value: stats.empleadosActivos },
    { label: 'Enrolamientos pendientes', value: stats.enrolamientosPendientes },
    { label: 'Checadas hoy', value: stats.checadasHoy },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Inicio</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{c.value ?? '—'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
