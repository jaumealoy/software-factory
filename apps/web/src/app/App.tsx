import { NavLink, Outlet } from "react-router-dom";
import { Toaster } from "./toast";

const linkBase: React.CSSProperties = {
  color: "#e6edf3",
  textDecoration: "none",
  fontSize: "0.95rem",
  padding: "0.35rem 0.75rem",
  borderRadius: "0.375rem",
};

function navLinkStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return isActive
    ? { ...linkBase, backgroundColor: "rgba(255,255,255,0.15)", fontWeight: 600 }
    : linkBase;
}

export function AppShell() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          backgroundColor: "#0d1117",
          color: "#e6edf3",
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
          padding: "0.75rem 1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.1rem", margin: 0 }}>Software Factory</h1>
        <nav style={{ display: "flex", gap: "0.25rem" }} aria-label="Primary">
          <NavLink to="/" end style={navLinkStyle}>
            Requests
          </NavLink>
          <NavLink to="/changes" style={navLinkStyle}>
            Changes
          </NavLink>
          <NavLink to="/runs" style={navLinkStyle}>
            Runs
          </NavLink>
        </nav>
      </header>
      <main
        style={{
          flex: 1,
          width: "100%",
          maxWidth: "56rem",
          margin: "0 auto",
          padding: "1.5rem 1rem",
        }}
      >
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
