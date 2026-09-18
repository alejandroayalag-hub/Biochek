import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

export default function EnrolamientosPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [enrolamientos, setEnrolamientos] = useState([]);
  const [estadoFiltro, setEstadoFiltro] = useState('pendiente');
  const [fotos, setFotos] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const params = estadoFiltro ? { estado: estadoFiltro } : {};
    const { data } = await api.get('/enrolamientos', { params });
    setEnrolamientos(data);
  }

  useEffect(() => { load(); }, [estadoFiltro]);

  async function verFotos(enrolamiento) {
    setError('');
    try {
      const urls = await Promise.all(
        (enrolamiento.foto_urls || []).map(async (_, index) => {
          const res = await api.get(`/enrolamientos/${enrolamiento.id}/foto/${index}`, { responseType: 'blob' });
          return URL.createObjectURL(res.data);
        })
      );
      setFotos({ enrolamientoId: enrolamiento.id, urls });
    } catch (err) {
      setError(err.response?.data?.error || 'Error al cargar las fotos');
    }
  }

  function cerrarFotos() {
    fotos?.urls.forEach((u) => URL.revokeObjectURL(u));
    setFotos(null);
  }

  async function handleAprobar(id) {
    setError('');
    try {
      await api.post(`/enrolamientos/${id}/aprobar`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al aprobar');
    }
  }

  async function handleRechazar(id) {
    setError('');
    try {
      await api.post(`/enrolamientos/${id}/rechazar`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al rechazar');
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Enrolamientos</h2>

      <div className="mb-4">
        <label className="text-xs text-gray-500 mr-2">Estado</label>
        <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm">
          <option value="">Todos</option>
          <option value="pendiente">Pendiente</option>
          <option value="aprobado">Aprobado</option>
          <option value="rechazado">Rechazado</option>
        </select>
      </div>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Empleado</th>
            <th className="px-4 py-2">Código NOI</th>
            <th className="px-4 py-2">Estado</th>
            <th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {enrolamientos.map((en) => (
            <tr key={en.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{en.nombre}</td>
              <td className="px-4 py-2">{en.codigo_noi}</td>
              <td className="px-4 py-2">{en.estado}</td>
              <td className="px-4 py-2">{new Date(en.fecha_enrolamiento).toLocaleString('es-MX')}</td>
              <td className="px-4 py-2 flex gap-2">
                <button onClick={() => verFotos(en)} className="text-blue-600 hover:underline">Ver fotos</button>
                {isAdmin && en.estado === 'pendiente' && (
                  <>
                    <button onClick={() => handleAprobar(en.id)} className="text-green-600 hover:underline">Aprobar</button>
                    <button onClick={() => handleRechazar(en.id)} className="text-red-600 hover:underline">Rechazar</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {fotos && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" onClick={cerrarFotos}>
          <div className="bg-white rounded-lg p-4 max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-gray-800">Fotos de enrolamiento</h3>
              <button onClick={cerrarFotos} className="text-gray-500 hover:text-gray-700">Cerrar</button>
            </div>
            <div className="flex gap-3 flex-wrap">
              {fotos.urls.map((url, i) => (
                <img key={i} src={url} alt={`Foto ${i + 1}`} className="w-40 h-40 object-cover rounded border border-gray-200" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
