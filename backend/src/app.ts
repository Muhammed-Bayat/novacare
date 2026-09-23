import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { getPool } from './db.js';

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp() {
  const app = express();
  const origins = allowedOrigins();

  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
  }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/v1/me', requireAuth, async (req, res, next) => {
    try {
      const auth = req.auth!;
      const result = await getPool().query<{
        id: string;
        auth0_subject: string;
        email: string | null;
        display_name: string | null;
      }>(
        `INSERT INTO users (auth0_subject, email, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (auth0_subject) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             display_name = COALESCE(EXCLUDED.display_name, users.display_name),
             updated_at = now()
         RETURNING id, auth0_subject, email, display_name`,
        [auth.subject, auth.email, auth.displayName],
      );
      const user = result.rows[0]!;
      res.json({ data: { id: user.id, auth0Subject: user.auth0_subject, email: user.email, displayName: user.display_name } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/sample', requireAuth, async (req, res, next) => {
    try {
      const existing = await getPool().query('SELECT 1 FROM users WHERE auth0_subject = $1', [req.auth!.subject]);
      if (!existing.rowCount) {
        res.status(403).json({ error: { code: 'USER_NOT_SYNCHRONIZED', message: 'Call /api/v1/me first' } });
        return;
      }
      res.json({ data: { message: 'Your protected NovaCare API connection is active.' } });
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
    console.error(error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  return app;
}
