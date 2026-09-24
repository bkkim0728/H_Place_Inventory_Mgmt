// Writes web/config.js from environment variables. Render runs this as the
// static site's build command; nothing else needs building.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_ANON_KEY || '').trim();

if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
  console.error(`SUPABASE_URL looks wrong: "${url}". Expected https://<project-ref>.supabase.co`);
  process.exit(1);
}
if (Boolean(url) !== Boolean(key)) {
  console.error('Set both SUPABASE_URL and SUPABASE_ANON_KEY, or neither (demo mode).');
  process.exit(1);
}

const out = fileURLToPath(new URL('../web/config.js', import.meta.url));
writeFileSync(out, `// Generated at build time by scripts/build-config.mjs\nwindow.APP_CONFIG = ${JSON.stringify({ supabaseUrl: url.replace(/\/$/, ''), supabaseAnonKey: key }, null, 2)};\n`);
console.log(url ? `config.js written for ${url}` : 'config.js written in demo mode (no Supabase settings)');
