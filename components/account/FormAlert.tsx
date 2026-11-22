/** The error line under a form: announced to screen readers as it appears. */
export function FormAlert({ message, tone = "error" }: { message: string | null; tone?: "error" | "success" }) {
  if (!message) return null;
  const style =
    tone === "error"
      ? "border-critical/25 bg-critical/10 text-critical-strong"
      : "border-success/25 bg-success/10 text-success-strong";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-caption font-medium ${style}`}>
      {message}
    </p>
  );
}
