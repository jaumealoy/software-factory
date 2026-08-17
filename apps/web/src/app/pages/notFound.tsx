import { useNavigate } from "react-router-dom";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <section>
      <h2>Page not found</h2>
      <p>The page you are looking for does not exist.</p>
      <button type="button" onClick={() => navigate("/")}>
        Go home
      </button>
    </section>
  );
}
