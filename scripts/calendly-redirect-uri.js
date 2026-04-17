require('dotenv').config();

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

function normalizePath(pathValue) {
  if (!pathValue) {
    return '/oauth/calendly/callback';
  }

  return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

const port = getArg('--port') || process.env.PORT || '3000';
const baseUrlInput =
  getArg('--base-url') ||
  process.env.CALENDLY_BASE_URL ||
  process.env.BASE_URL ||
  `http://localhost:${port}`;
const callbackPath = normalizePath(
  getArg('--callback-path') || process.env.CALENDLY_REDIRECT_PATH
);
const redirectUri = `${normalizeBaseUrl(baseUrlInput)}${callbackPath}`;

const calendlyAuthUrl =
  process.env.CALENDLY_AUTH_URL || 'https://auth.calendly.com/oauth/authorize';
const clientId = getArg('--client-id') || process.env.CALENDLY_CLIENT_ID;
const state = getArg('--state') || 'replace-with-random-state';

console.log('Calendly OAuth Redirect URI');
console.log('---------------------------');
console.log(`Redirect URI: ${redirectUri}`);
console.log(`Encoded URI : ${encodeURIComponent(redirectUri)}`);

if (!clientId) {
  console.log('');
  console.log('Set CALENDLY_CLIENT_ID (or pass --client-id) to print full auth URL.');
  process.exit(0);
}

const authorizeParams = new URLSearchParams({
  client_id: clientId,
  response_type: 'code',
  redirect_uri: redirectUri,
  state
});

console.log('');
console.log('Authorization URL');
console.log('-----------------');
console.log(`${calendlyAuthUrl}?${authorizeParams.toString()}`);
