import { readFileSync } from "fs";
import path from "path";

export const dynamic = "force-static";

export default function HomePage() {
  const html = readFileSync(
    path.join(process.cwd(), "public", "landing.html"),
    "utf-8"
  );
  // Extract just the body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : "";
  // Extract styles
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  const styles = styleMatch ? styleMatch.join("\n") : "";

  return (
    <div
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: styles + body }}
    />
  );
}
