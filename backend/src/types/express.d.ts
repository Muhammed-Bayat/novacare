declare global {
  namespace Express {
    interface Request {
      auth?: {
        subject: string;
        email: string | null;
        displayName: string | null;
      };
    }
  }
}

export {};
