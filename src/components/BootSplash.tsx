export default function BootSplash() {
  return (
    <div
      role="status"
      aria-label="Starting Trivo Chat Elite"
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#08090d",
        color: "#e8ecf5",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 16 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "3px solid rgba(232,236,245,0.18)",
            borderTopColor: "#4f7cff",
            animation: "trivo-boot-spin 800ms linear infinite",
          }}
        />
        <strong style={{ fontSize: 16 }}>Trivo Chat Elite</strong>
      </div>
      <style>{`@keyframes trivo-boot-spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { [role="status"] div div { animation: none !important; } }`}</style>
    </div>
  );
}