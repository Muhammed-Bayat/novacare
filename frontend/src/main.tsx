import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import { BrowserRouter } from 'react-router-dom';
import './styles/mockup-base.css';
import App from './App.tsx';

const rootElement = document.getElementById('root');
const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

if (!rootElement) throw new Error('Root element #root was not found');
if (!domain || !clientId || !audience) {
  throw new Error('Auth0 environment variables are not configured');
}

createRoot(rootElement).render(
  <StrictMode>
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      cacheLocation="localstorage"
      useCookiesForTransactions
      authorizationParams={{
        audience,
        redirect_uri: window.location.origin,
        scope: 'openid profile email',
      }}
      onRedirectCallback={(appState) => {
        window.history.replaceState({}, document.title, appState?.returnTo ?? window.location.pathname);
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Auth0Provider>
  </StrictMode>,
);
