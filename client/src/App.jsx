import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Animals from './pages/Animals.jsx';
import AnimalDetail from './pages/AnimalDetail.jsx';
import Milk from './pages/Milk.jsx';
import Customers from './pages/Customers.jsx';
import CustomerDetail from './pages/CustomerDetail.jsx';
import Sales from './pages/Sales.jsx';
import { InvoicePrint, ReceiptPrint } from './pages/Print.jsx';
import Inventory from './pages/Inventory.jsx';
import Health from './pages/Health.jsx';
import Breeding from './pages/Breeding.jsx';
import Finance from './pages/Finance.jsx';
import Employees from './pages/Employees.jsx';
import Tasks from './pages/Tasks.jsx';
import Reminders from './pages/Reminders.jsx';
import Reports from './pages/Reports.jsx';
import SettingsPage from './pages/Settings.jsx';

export default function App() {
  const { loading, me } = useAuth();
  if (loading) return <div className="auth-wrap"><Spinner /></div>;
  if (!me) return <Login />;
  return (
    <Routes>
      <Route path="/print/invoice/:id" element={<InvoicePrint />} />
      <Route path="/print/receipt/:id" element={<ReceiptPrint />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="animals" element={<Animals />} />
        <Route path="animals/:id" element={<AnimalDetail />} />
        <Route path="milk" element={<Milk />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="sales" element={<Sales />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="health" element={<Health />} />
        <Route path="breeding" element={<Breeding />} />
        <Route path="finance" element={<Finance />} />
        <Route path="employees" element={<Employees />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="reminders" element={<Reminders />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
