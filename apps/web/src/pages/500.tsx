export default function Custom500() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0b11", color: "#e5e7eb" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: "2rem" }}>500</h1>
        <p style={{ marginTop: "0.5rem" }}>Something went wrong.</p>
      </div>
    </main>
  );
}
