import type { Membership } from '../authorization.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        subject: string;
        email: string | null;
        displayName: string | null;
      };
      membership?: Membership;
      hospitalId?: string;
    }
  }
}

export {};
