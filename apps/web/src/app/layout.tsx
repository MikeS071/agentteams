import type { Metadata } from "next";
import SessionWrapper from "@/components/SessionWrapper";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://agentsquads.ai"),
  title: "AgentSquads — Your AI Team, Ready to Work",
  description:
    "Deploy AI agents for research, coding, lead gen, and more. Pay per token, no subscriptions.",
  openGraph: {
    title: "AgentSquads — Your AI Team, Ready to Work",
    description:
      "Deploy AI agents for research, coding, lead gen, and more. Pay per token, no subscriptions.",
    url: "https://agentsquads.ai",
    siteName: "AgentSquads",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AgentSquads",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentSquads — Your AI Team, Ready to Work",
    description:
      "Deploy AI agents for research, coding, lead gen, and more. Pay per token, no subscriptions.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-text antialiased">
        <SessionWrapper>{children}</SessionWrapper>
      </body>
    </html>
  );
}
