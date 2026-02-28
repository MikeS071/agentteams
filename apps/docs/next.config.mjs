import nextra from 'nextra';

const withNextra = nextra({
  search: {
    codeblocks: false
  }
});

const basePath = process.env.DOCS_BASE_PATH || '';

export default withNextra({
  reactStrictMode: true,
  output: 'standalone',
  basePath
});
