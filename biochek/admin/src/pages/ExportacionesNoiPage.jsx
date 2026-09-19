import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

export default function ExportacionesNoiPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [exportaciones, setExportaciones] = useState([]);
  const [filtros, setFiltros] = useState({ desde: '', hasta: '' });
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    const { data } = await api.get('/exportaciones-noi');
    setExportaciones(data);
  }

  useEffect(() => { load(); }, []);

  async function handleGenerar(e) {
    e.preventDefault();
    setError('');
    setMensaje('');
    if (!filtros.desde || !filtros.hasta) {
      setError('Selecciona un rango de fechas');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/exportaciones-noi', filtros);
      setMensaje(`Exportación generada: ${data.total} checadas`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al generar la exportación');
    } finally {
      setLoading(false);
    }
  }

  async function handleDescargar(id) {
    setError('');
    setMensaje('');
    try {
      const res = await api.get(`/exportaciones-noi/${id}/descargar`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exportacion-noi-${id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al descargar la exportación');
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Exportación NOI</h2>

      {isAdmin && (
        <form onSubmit={handleGenerar} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Desde</label>
            <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hasta</label>
            <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <button type="submit" disabled={loading} className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-800 disabled:opacity-50">
            {loading ? 'Generando...' : 'Generar exportación'}
          </button>
        </form>
      )}
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {mensaje && <p className="text-green-600 text-sm mb-4">{mensaje}</p>}

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Rango</th>
            <th className="px-4 py-2">Generada</th>
            <th className="px-4 py-2">Disparada por</th>
            <th className="px-4 py-2">Descarga</th>
          </tr>
        </thead>
        <tbody>
          {exportaciones.map((ex) => (
            <tr key={ex.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{ex.desde} — {ex.hasta}</td>
              <td className="px-4 py-2">{new Date(ex.created_at).toLocaleString('es-MX')}</td>
              <td className="px-4 py-2">{ex.disparado_por_email || '—'}</td>
              <td className="px-4 py-2">
                <button onClick={() => handleDescargar(ex.id)} className="text-blue-600 hover:underline">Descargar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!exportaciones.length && <p className="text-gray-400 text-sm mt-4">Sin exportaciones generadas todavía.</p>}
    </div>
  );
}
