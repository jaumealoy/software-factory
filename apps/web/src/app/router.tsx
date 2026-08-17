import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { AppShell } from "./App";
import { HomePage } from "./pages/home";
import { ChangesPage } from "./pages/changes";
import { ChangeDetailPage } from "./pages/changeDetail";
import { RunsPage } from "./pages/runs";
import { ConfigurationPage } from "./pages/configuration";
import { SettingsPage } from "./pages/settings";
import { NotFoundPage } from "./pages/notFound";

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "changes", element: <ChangesPage /> },
      { path: "changes/:changeId", element: <ChangeDetailPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "configuration", element: <ConfigurationPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
