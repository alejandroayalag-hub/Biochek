import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearSession } from '../auth/session';

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/empleados', label: 'Empleados' },
  { to: '/sedes', label: 'Sedes' },
  { to: '/enrolamientos', label: 'Enrolamientos' },
  { to: '/reportes', label: 'Reportes' },
  { to: '/dispositivos', label: 'Dispositivos' },
  { to: '/exportacion-noi', label: 'Exportación NOI' },
];

export default function Layout() {
  const navigate = useNavigate();
  const user = getUser();

  function logout() {
    clearSession();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-200">
          <h1 className="font-bold text-gray-800">BioChek</h1>
          <p className="text-xs text-gray-400 uppercase tracking-widest">Admin</p>
        </div>
        <nav className="flex-1 px-2 py-4 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `px-3 py-2 rounded-lg text-sm ${
                  isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-gray-200">
          <p className="text-sm text-gray-700 truncate">{user?.email}</p>
          <p className="text-xs text-gray-400 uppercase">{user?.role}</p>
          <button
            onClick={logout}
            className="mt-2 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1 w-full"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
