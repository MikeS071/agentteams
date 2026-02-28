import { promises as fs } from 'node:fs';
import path from 'node:path';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

async function listRouteFiles(dir) {
  let entries;

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return listRouteFiles(fullPath);
      }

      if (entry.isFile() && entry.name === 'route.ts') {
        return [fullPath];
      }

      return [];
    })
  );

  return nested.flat();
}

function extractMethods(fileContent) {
  const regex = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  const methods = new Set();
  let match;

  while ((match = regex.exec(fileContent)) !== null) {
    methods.add(match[1]);
  }

  return METHODS.filter((method) => methods.has(method));
}

function toEndpointPath(apiRoot, filePath) {
  const relative = path.relative(apiRoot, filePath);
  const endpointPart = relative.replace(/\\/g, '/').replace(/\/route\.ts$/, '');
  return `/api/${endpointPart}`;
}

function renderMarkdown(routes) {
  const generatedAt = new Date().toISOString();

  const header = `# API Reference\n\nThis page is auto-generated from route files in \`apps/web/src/app/api\`.\n\n_Last generated: ${generatedAt}_\n\n## Endpoint Index\n\n| Endpoint | Methods | Source |\n| --- | --- | --- |\n`;

  const tableRows = routes
    .map((route) => {
      const methods = route.methods.length > 0 ? route.methods.join(', ') : 'Unknown';
      return `| \`${route.endpoint}\` | \`${methods}\` | \`${route.source}\` |`;
    })
    .join('\n');

  const sections = routes
    .map((route) => {
      const methods = route.methods.length > 0 ? route.methods.join(', ') : 'Unknown';
      const curlMethod = route.methods[0] ?? 'GET';
      const curlData = curlMethod === 'GET' ? '' : " \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"example\":\"value\"}'";

      return `\n## \`${route.endpoint}\`\n\n- Methods: \`${methods}\`\n- Source: \`${route.source}\`\n\n\`\`\`bash\ncurl -X ${curlMethod} \"https://your-domain.com${route.endpoint}\"${curlData}\n\`\`\`\n`;
    })
    .join('\n');

  return `${header}${tableRows}\n${sections}`;
}

async function main() {
  const docsRoot = path.resolve(process.cwd());
  const repoRoot = path.resolve(docsRoot, '../..');
  const apiRoot = path.resolve(repoRoot, 'apps/web/src/app/api');
  const outputFile = path.resolve(docsRoot, 'src/content/api-reference.mdx');

  const routeFiles = await listRouteFiles(apiRoot);

  const routes = await Promise.all(
    routeFiles.map(async (filePath) => {
      const content = await fs.readFile(filePath, 'utf8');
      const methods = extractMethods(content);
      const endpoint = toEndpointPath(apiRoot, filePath);
      const source = path.relative(repoRoot, filePath).replace(/\\/g, '/');

      return {
        endpoint,
        methods,
        source
      };
    })
  );

  routes.sort((a, b) => a.endpoint.localeCompare(b.endpoint));

  const markdown = renderMarkdown(routes);

  await fs.writeFile(outputFile, markdown, 'utf8');

  console.log(`Generated API reference with ${routes.length} routes at ${outputFile}`);
}

main().catch((error) => {
  console.error('Failed to generate API reference:', error);
  process.exit(1);
});
