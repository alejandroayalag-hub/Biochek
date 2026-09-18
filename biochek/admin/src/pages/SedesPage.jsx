import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

const emptyForm = { nombre: '', direccion: '', lat: '', lng: '', radio_metros: '' };

export default function SedesPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [sedes, setSedes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/sedes');
    setSedes(data);
  }

  useEffect(() => { load(); }, []);

  function startEdit(sede) {
    setEditingId(sede.id);
    setForm({
      nombre: sede.nombre,
      direccion: sede.direccion || '',
      lat: sede.lat,
      lng: sede.lng,
      radio_metros: sede.radio_metros,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const payload = {
      ...form,
      lat: Number(form.lat),
      lng: Number(form.lng),
      radio_metros: Number(form.radio_metros),
    };
    try {
      if (editingId) {
        await api.put(`/sedes/${editingId}`, payload);
      } else {
        await api.post('/sedes', payload);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar');
    }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar esta sede?')) return;
    await api.delete(`/sedes/${id}`);
    await load();
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Sedes</h2>

      {isAdmin && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Dirección</label>
            <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Lat</label>
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm w-24" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Lng</label>
            <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm w-24" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Radio (m)</label>
            <input value={form.radio_metros} onChange={(e) => setForm({ ...form, radio_metros: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm w-24" required />
          </div>
          <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-800">
            {editingId ? 'Guardar' : 'Agregar'}
          </button>
          {editingId && <button type="button" onClick={cancelEdit} className="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>}
        </form>
      )}
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Nombre</th>
            <th className="px-4 py-2">Dirección</th>
            <th className="px-4 py-2">Lat, Lng</th>
            <th className="px-4 py-2">Radio (m)</th>
            {isAdmin && <th className="px-4 py-2">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {sedes.map((s) => (
            <tr key={s.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{s.nombre}</td>
              <td className="px-4 py-2">{s.direccion || '—'}</td>
              <td className="px-4 py-2">{s.lat}, {s.lng}</td>
              <td className="px-4 py-2">{s.radio_metros}</td>
              {isAdmin && (
                <td className="px-4 py-2 flex gap-2">
                  <button onClick={() => startEdit(s)} className="text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:underline">Eliminar</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
