require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MYCASE_AUTH_URL = process.env.MYCASE_AUTH_URL || 'https://auth.mycase.com/login_sessions/new';
const MYCASE_TOKEN_URL = process.env.MYCASE_TOKEN_URL || 'https://auth.mycase.com/tokens';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getBaseUrl(req) {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
}

function getRedirectUri(req) {
  return `${getBaseUrl(req)}/callback`;
}

function getClientCredentials() {
  return {
    clientId: process.env.MYCASE_CLIENT_ID,
    clientSecret: process.env.MYCASE_CLIENT_SECRET
  };
}

async function exchangeCodeForToken({ code, redirectUri, clientId, clientSecret }) {
  return axios.post(MYCASE_TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret
  });
}

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start OAuth flow from backend to avoid copy/paste issues.
app.get('/start-auth', (req, res) => {
  const { clientId, clientSecret } = getClientCredentials();
  const redirectUri = getRedirectUri(req);

  if (!clientId || !clientSecret) {
    return res.status(400).send(
      'Missing MYCASE_CLIENT_ID or MYCASE_CLIENT_SECRET in environment variables.'
    );
  }

  const state = req.query.state || `state-${Date.now()}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state
  });

  return res.redirect(`${MYCASE_AUTH_URL}?${params.toString()}`);
});

// The OAuth callback handler
app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const redirectUri = getRedirectUri(req);
  const { clientId, clientSecret } = getClientCredentials();

  if (error) {
    return res.status(400).send(`
      <h1>OAuth Error</h1>
      <p><strong>${error}</strong></p>
      <p>${error_description || ''}</p>
    `);
  }

  if (!code) {
    return res.status(400).send('Missing "code" in callback URL.');
  }

  if (!clientId || !clientSecret) {
    return res.status(400).send(
      'Missing MYCASE_CLIENT_ID or MYCASE_CLIENT_SECRET in environment variables.'
    );
  }

  try {
    const response = await exchangeCodeForToken({
      code,
      redirectUri,
      clientId,
      clientSecret
    });
    const data = response.data;
    const safeJson = escapeHtml(JSON.stringify(data, null, 2));

    return res.status(200).send(`
      <h1>MyCase OAuth Success</h1>
      <p>Save your <strong>refresh_token</strong> now.</p>
      <p><strong>state:</strong> ${state || 'n/a'}</p>
      <pre>${safeJson}</pre>
    `);
  } catch (err) {
    const statusCode = err.response?.status || 500;
    const message = JSON.stringify(err.response?.data || { error: err.message }, null, 2)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');

    console.error('Token exchange error in callback:', err.response?.data || err.message);
    return res.status(statusCode).send(`
      <h1>Token Exchange Failed</h1>
      <pre>${message}</pre>
    `);
  }
});

// Endpoint to exchange code for token (called by frontend)
app.post('/api/exchange-token', async (req, res) => {
  const { code } = req.body;
  const redirectUri = getRedirectUri(req);

  const { clientId, clientSecret } = getClientCredentials();

  if (!clientId || !clientSecret) {
    return res.status(400).json({
      error: 'Client credentials not configured. Please set MYCASE_CLIENT_ID and MYCASE_CLIENT_SECRET in your .env file.'
    });
  }

  try {
    const response = await exchangeCodeForToken({
      code,
      redirectUri,
      clientId,
      clientSecret
    });

    res.json(response.data);
  } catch (err) {
    console.error('Token exchange error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Internal server error during token exchange' });
  }
});

// Exchange refresh token for a new access token.
app.post('/api/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  const { clientId, clientSecret } = getClientCredentials();

  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required in request body.' });
  }

  if (!clientId || !clientSecret) {
    return res.status(400).json({
      error: 'Client credentials not configured. Please set MYCASE_CLIENT_ID and MYCASE_CLIENT_SECRET in your .env file.'
    });
  }

  try {
    const response = await axios.post(MYCASE_TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    });

    return res.json(response.data);
  } catch (err) {
    console.error('Refresh token exchange error:', err.response?.data || err.message);
    return res.status(err.response?.status || 500).json(
      err.response?.data || { error: 'Internal server error during refresh token exchange' }
    );
  }
});

// Lightweight callback page for Calendly OAuth redirect URI registration/testing.
app.get('/oauth/calendly/callback', (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`
      <h1>Calendly OAuth Error</h1>
      <p><strong>${escapeHtml(error)}</strong></p>
      <p>${escapeHtml(error_description || '')}</p>
    `);
  }

  if (!code) {
    return res.status(400).send(`
      <h1>Calendly OAuth Callback</h1>
      <p>Missing "code" in callback URL.</p>
    `);
  }

  return res.status(200).send(`
    <h1>Calendly OAuth Success</h1>
    <p>Authorization code received.</p>
    <p><strong>code:</strong> ${escapeHtml(code)}</p>
    <p><strong>state:</strong> ${escapeHtml(state || 'n/a')}</p>
  `);
});

module.exports = app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  const redirectUri = `${baseUrl}/callback`;

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Your Redirect URI is: ${redirectUri}`);
  });
}
