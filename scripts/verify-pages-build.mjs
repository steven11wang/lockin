import { readFileSync } from 'node:fs';

const requiredText = (path, pattern, description) => {
  const contents = readFileSync(path, 'utf8');
  if (!pattern.test(contents)) {
    throw new Error(`${description} was not found in ${path}.`);
  }
};

requiredText(
  'dist/index.html',
  /(?:src|href)="\/lockin\/(?:assets|manifest\.webmanifest|registerSW\.js)/,
  'A /lockin/ production asset URL',
);
requiredText(
  'dist/manifest.webmanifest',
  /"start_url":"\/lockin\/"/,
  'The GitHub Pages start URL',
);
requiredText(
  'dist/manifest.webmanifest',
  /"scope":"\/lockin\/"/,
  'The GitHub Pages manifest scope',
);
requiredText(
  'dist/registerSW.js',
  /register\('\/lockin\/sw\.js'/,
  'The scoped service-worker registration',
);
requiredText(
  'dist/sw.js',
  /createHandlerBoundToURL\("\/lockin\/index\.html"\)/,
  'The scoped navigation fallback',
);
requiredText(
  '.github/workflows/deploy-pages.yml',
  /path:\s*['"]?\.\/dist['"]?/,
  'The dist artifact upload',
);

console.log('GitHub Pages build verified for /lockin/.');
