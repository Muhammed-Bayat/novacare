import './config.js';
import { createApp } from './app.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured before starting the callback-enabled server.`);
  return value;
}

const port = Number(process.env.PORT ?? 4000);
createApp({
  channelCallbacks: {
    secret: requiredEnvironment('AT_CALLBACK_SECRET'),
    ussdServiceCode: requiredEnvironment('AT_USSD_SERVICE_CODE'),
  },
}).listen(port, () => console.log(`NovaCare API listening on port ${port}`));
