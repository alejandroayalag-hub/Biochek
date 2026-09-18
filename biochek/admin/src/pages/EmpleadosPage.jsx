import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

const emptyForm = { nombre: '', codigo_noi: '', sede_id: '', estado: 'activo' };

export default function EmpleadosPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [empleados, setEmpleados] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [lastPin, setLastPin] = useState(null);

  async function load() {
    const [e, s] = await Promise.all([api.get('/empleados'), api.get('/sedes')]);
    setEmpleados(e.data);
    setSedes(s.data);
  }

  useEffect(() => { load(); }, []);

  function sedeName(id) {
    return sedes.find((s) => s.id === id)?.nombre || '—';
  }

  function startEdit(empleado) {
    setEditingId(empleado.id);
    setForm({
      nombre: empleado.nombre,
      codigo_noi: empleado.codigo_noi,
      sede_id: empleado.sede_id,
      estado: empleado.estado,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.put(`/empleados/${editingId}`, form);
      } else {
        const { data } = await api.post('/empleados', form);
        setLastPin({ nombre: data.nombre, pin: data.pin });
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar');
    }
  }

  async function handleDelete(id) {
    if (!confirm('¿Dar de baja este empleado?')) return;
    await api.delete(`/empleados/${id}`);
    await load();
  }

  async function handleResetPin(id, nombre) {
    if (!confirm(`¿Restablecer PIN de ${nombre}?`)) return;
    const { data } = await api.post(`/empleados/${id}/reset-pin`);
    setLastPin({ nombre, pin: data.pin });
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Empleados</h2>

      {lastPin && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-2 mb-4 text-sm">
          PIN de {lastPin.nombre}: <span className="font-mono font-bold">{lastPin.pin}</span> (anótalo, no se vuelve a mostrar)
        </div>
      )}

      {isAdmin && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Código NOI</label>
            <input value={form.codigo_noi} onChange={(e) => setForm({ ...form, codigo_noi: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Sede</label>
            <select value={form.sede_id} onChange={(e) => setForm({ ...form, sede_id: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required>
              <option value="">Selecciona</option>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          {editingId && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Estado</label>
              <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="activo">Activo</option>
                <option value="baja">Baja</option>
              </select>
            </div>
          )}
          <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-800">
            {editingId ? 'Guardar' : 'Agregar'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          )}
        </form>
      )}
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Nombre</th>
            <th className="px-4 py-2">Código NOI</th>
            <th className="px-4 py-2">Sede</th>
            <th className="px-4 py-2">Estado</th>
            {isAdmin && <th className="px-4 py-2">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {empleados.map((emp) => (
            <tr key={emp.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{emp.nombre}</td>
              <td className="px-4 py-2">{emp.codigo_noi}</td>
              <td className="px-4 py-2">{sedeName(emp.sede_id)}</td>
              <td className="px-4 py-2">{emp.estado}</td>
              {isAdmin && (
                <td className="px-4 py-2 flex gap-2">
                  <button onClick={() => startEdit(emp)} className="text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => handleResetPin(emp.id, emp.nombre)} className="text-amber-600 hover:underline">Reset PIN</button>
                  <button onClick={() => handleDelete(emp.id)} className="text-red-600 hover:underline">Baja</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
