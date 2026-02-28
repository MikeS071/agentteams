import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import 'nextra-theme-docs/style-prefixed.css';
import './globals.css';

export const metadata = {
  metadataBase: new URL('https://docs.agentteams.dev'),
  title: {
    default: 'AgentTeams Docs',
    template: '%s | AgentTeams Docs'
  },
  description:
    'Official AgentTeams documentation for channels, agents, workflows, swarm orchestration, deploy, billing, and API usage.'
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const pageMap = await getPageMap('/');

  return (
    <html lang="en" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={
            <Navbar
              logo={
                <span className="flex items-center gap-2 font-semibold text-text">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent3 shadow-[0_0_18px_rgba(0,206,201,0.8)]" />
                  AgentTeams Docs
                </span>
              }
            />
          }
          footer={
            <Footer>
              AgentTeams © {new Date().getFullYear()} · Built for production AI agent operations
            </Footer>
          }
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/agentteams/agentteams"
          editLink={null}
          darkMode
          nextThemes={{
            defaultTheme: 'dark'
          }}
          sidebar={{
            defaultMenuCollapseLevel: 1
          }}
          toc={{
            float: true,
            backToTop: 'Back to top'
          }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
