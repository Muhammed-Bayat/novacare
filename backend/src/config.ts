import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve this package's .env rather than relying on the workspace command cwd.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
