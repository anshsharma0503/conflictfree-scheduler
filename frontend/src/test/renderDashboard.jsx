import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DashboardApp from "../pages/dashboard/DashboardApp";

/**
 * Renders the full dashboard route tree starting at `path`, so tests can
 * follow the real navigation between Overview, Events, the composer,
 * Find a time and Rooms & equipment.
 */
export function renderDashboard(path = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/*" element={<DashboardApp />} />
      </Routes>
    </MemoryRouter>,
  );
}
