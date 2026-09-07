import { t } from "../../lib/i18n";

interface Props {
  children: unknown;
}

export default function AppShell({ children }: Props) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-solid)",
          position: "sticky",
          top: 0,
          zIndex: 5,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
          <span style={{ fontSize: 18 }}>🍺</span>
          <span>{t("app.title")}</span>
          <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: "var(--text-sm)", marginLeft: 6 }}>Estaminet</span>
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Tauri + Preact</div>
      </header>
      <main style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px var(--gutter)", gap: 16, maxWidth: 1200, width: "100%", margin: "0 auto" }}>
        {children as any}
      </main>
    </div>
  );
}
