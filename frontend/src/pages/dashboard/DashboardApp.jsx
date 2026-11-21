import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "../../components/AppShell";
import DashboardProvider from "../../context/DashboardProvider";
import EventComposerPage from "./EventComposerPage";
import EventsPage from "./EventsPage";
import FindTimePage from "./FindTimePage";
import OverviewPage from "./OverviewPage";
import ResourcesPage from "./ResourcesPage";

/**
 * Everything under /dashboard. Mounted at "/dashboard/*" so the
 * provider's state survives moving between the dashboard pages.
 */
function DashboardApp() {
  return (
    <DashboardProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/new" element={<EventComposerPage />} />
          <Route path="find-time" element={<FindTimePage />} />
          <Route path="resources" element={<ResourcesPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </DashboardProvider>
  );
}

export default DashboardApp;
