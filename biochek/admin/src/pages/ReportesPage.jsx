import { useEffect, useState } from 'react';
import api from '../api/client';

export default function ReportesPage() {
  const [empleados, setEmpleados] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [filtros, setFiltros] = useState({ empleado_id: '', sede_id: '', desde: '', hasta: '' });
  const [checadas, setChecadas] = useState([]);

  useEffect(() => {
    Promise.all([api.get('/empleados'), api.get('/sedes')]).then(([e, s]) => {
      setEmpleados(e.data);
      setSedes(s.data);
    });
  }, []);

  function empleadoNombre(id) {
    return empleados.find((e) => e.id === id)?.nombre || `#${id}`;
  }

  function sedeNombre(id) {
    return sedes.find((s) => s.id === id)?.nombre || '—';
  }

  function empleadoSede(empleadoId) {
    return empleados.find((e) => e.id === empleadoId)?.sede_id;
  }

  async function buscar(e) {
    e.preventDefault();
    const params = {};
    if (filtros.empleado_id) params.empleado_id = filtros.empleado_id;
    if (filtros.sede_id) params.sede_id = filtros.sede_id;
    if (filtros.desde) params.desde = filtros.desde;
    if (filtros.hasta) params.hasta = filtros.hasta;
    const { data } = await api.get('/checadas', { params });
    setChecadas(data);
  }

  function exportarCSV() {
    const header = ['Fecha', 'Empleado', 'Sede', 'Tipo', 'Origen', 'Método'];
    const rows = checadas.map((c) => [
      new Date(c.timestamp).toLocaleString('es-MX'),
      empleadoNombre(c.empleado_id),
      sedeNombre(empleadoSede(c.empleado_id)),
      c.tipo,
      c.origen,
      c.metodo || '',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checadas-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Reportes de checadas</h2>

      <form onSubmit={buscar} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Empleado</label>
          <select value={filtros.empleado_id} onChange={(e) => setFiltros({ ...filtros, empleado_id: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">Todos</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sede</label>
          <select value={filtros.sede_id} onChange={(e) => setFiltros({ ...filtros, sede_id: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">Todas</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-800">Buscar</button>
        <button type="button" onClick={exportarCSV} disabled={!checadas.length} className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
          Exportar CSV
        </button>
      </form>

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">Empleado</th>
            <th className="px-4 py-2">Sede</th>
            <th className="px-4 py-2">Tipo</th>
            <th className="px-4 py-2">Origen</th>
          </tr>
        </thead>
        <tbody>
          {checadas.map((c) => (
            <tr key={c.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{new Date(c.timestamp).toLocaleString('es-MX')}</td>
              <td className="px-4 py-2">{empleadoNombre(c.empleado_id)}</td>
              <td className="px-4 py-2">{sedeNombre(empleadoSede(c.empleado_id))}</td>
              <td className="px-4 py-2">{c.tipo}</td>
              <td className="px-4 py-2">{c.origen}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!checadas.length && <p className="text-gray-400 text-sm mt-4">Sin resultados — ajusta los filtros y busca.</p>}
    </div>
  );
}
