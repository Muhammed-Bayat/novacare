import type { RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

function authConfig() {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !audience) return undefined;
  return { domain, audience };
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const config = authConfig();
  if (!config) {
    res.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Auth0 is not configured' } });
    return;
  }

  const token = req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
    return;
  }

  try {
    const keySet = createRemoteJWKSet(new URL(`https://${config.domain}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, keySet, {
      issuer: `https://${config.domain}/`,
      audience: config.audience,
      algorithms: ['RS256'],
    });
    if (!payload.sub) throw new Error('Token has no subject');
    req.auth = {
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      displayName: typeof payload.name === 'string' ? payload.name : null,
    };
    next();
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid access token' } });
  }
};
