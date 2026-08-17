import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  ChevronsLeft,
  ChevronsRight,
  Factory,
  Folder,
  ListTodo,
  Play,
  Settings2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV_ENTRIES: NavEntry[] = [
  { to: "/", label: "Feature requests", icon: ListTodo, end: true },
  { to: "/changes", label: "Changes", icon: Folder },
  { to: "/runs", label: "Runs", icon: Play },
  { to: "/configuration", label: "Project configuration", icon: Settings2 },
  { to: "/settings", label: "Settings", icon: Wrench },
];

const COLLAPSE_KEY = "factory.sidebarCollapsed";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }

  return (
    <aside
      aria-label="Factory"
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-muted/30 transition-[width] duration-150",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        <Factory className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        {!collapsed && <span className="truncate text-sm font-semibold">Software Factory</span>}
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Primary">
        {NAV_ENTRIES.map((entry) => (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.end}
            title={entry.label}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isActive && "bg-accent text-accent-foreground",
                collapsed && "justify-center px-0",
              )
            }
          >
            <entry.icon className="h-4 w-4 shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{entry.label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center justify-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" aria-hidden />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" aria-hidden />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
