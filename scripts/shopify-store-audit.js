#!/usr/bin/env node
/**
 * Shopify store audit — pulls shop identity, plan, domains, scopes, and a few
 * optional resources (locations, webhooks) when your token has access.
 *
 * Auth (pick one):
 *   A) SHOPIFY_ACCESS_TOKEN=shpat_...  (custom app token or any Admin API token)
 *   B) SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  (Dev Dashboard app — same store;
 *      Shopify exchanges these for a token via grant_type=client_credentials.
 *      That token expires in ~24h; re-run the script to refresh.)
 *
 * Always required:
 *   SHOPIFY_SHOP=your-store.myshopify.com
 *
 * Optional:
 *   SHOPIFY_API_VERSION=2025-10
 *
 * Run: node scripts/shopify-store-audit.js
 *      npm run shopify:audit
 */

require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DEFAULT_API_VERSION = "2025-10";

function normalizeShop(raw) {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

const SHOP = normalizeShop(process.env.SHOPIFY_SHOP);
const API_VERSION = (process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim();

function sanitizeAxiosError(err) {
  if (err.config?.headers) {
    delete err.config.headers["X-Shopify-Access-Token"];
    delete err.config.headers["Authorization"];
  }
  if (err.config?.data && typeof err.config.data === "string") {
    err.config.data = err.config.data.replace(
      /client_secret=[^&]+/gi,
      "client_secret=REDACTED"
    );
  }
}

async function resolveAccessToken() {
  const direct = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
  if (direct) {
    return {
      token: direct,
      source: "SHOPIFY_ACCESS_TOKEN",
      expiresIn: null,
      scope: null,
    };
  }

  const clientId = (process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing auth: set SHOPIFY_ACCESS_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (see .env.example)."
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await axios.post(
    `https://${SHOP}/admin/oauth/access_token`,
    body.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      validateStatus: () => true,
      timeout: 60000,
    }
  );

  if (res.status < 200 || res.status >= 300 || !res.data?.access_token) {
    const detail =
      typeof res.data === "object" ? JSON.stringify(res.data) : String(res.data);
    throw new Error(
      `Client credentials token request failed (HTTP ${res.status}): ${detail}`
    );
  }

  return {
    token: res.data.access_token,
    source: "client_credentials",
    expiresIn: res.data.expires_in ?? null,
    scope: res.data.scope ?? null,
  };
}

function createClients(token) {
  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const rest = axios.create({
    baseURL: `https://${SHOP}/admin/api/${API_VERSION}`,
    headers,
    validateStatus: () => true,
    timeout: 60000,
  });

  const oauth = axios.create({
    baseURL: `https://${SHOP}/admin`,
    headers,
    validateStatus: () => true,
    timeout: 60000,
  });

  return { rest, oauth, headers };
}

async function restGet(client, label, urlPath) {
  const res = await client.get(urlPath);
  const ok = res.status >= 200 && res.status < 300;
  return {
    label,
    ok,
    status: res.status,
    data: res.data,
    error: ok ? null : res.data?.errors || res.statusText,
  };
}

async function graphqlQuery(rest, query, variables = {}) {
  const res = await rest.post("/graphql.json", {
    query,
    variables,
  });
  const ok = res.status >= 200 && res.status < 300 && !res.data?.errors?.length;
  return {
    ok,
    status: res.status,
    data: res.data?.data ?? null,
    errors: res.data?.errors || null,
    extensions: res.data?.extensions,
  };
}

const SHOP_GQL = `
  query ShopAudit {
    shop {
      id
      name
      email
      contactEmail
      myshopifyDomain
      url
      description
      ianaTimezone
      currencyCode
      weightUnit
      taxesIncluded
      checkoutApiSupported
      enabledPresentmentCurrencies
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
      primaryDomain {
        host
        url
        sslEnabled
      }
      billingAddress {
        address1
        address2
        city
        province
        country
        zip
        phone
      }
      currencyFormats {
        moneyFormat
        moneyWithCurrencyFormat
      }
    }
  }
`;

async function main() {
  if (!SHOP) {
    console.error("Missing SHOPIFY_SHOP (e.g. your-store.myshopify.com).");
    process.exit(1);
  }

  const auth = await resolveAccessToken();
  const { rest, oauth } = createClients(auth.token);

  const report = {
    generatedAt: new Date().toISOString(),
    shopDomain: SHOP,
    apiVersion: API_VERSION,
    authSource: auth.source,
    tokenExpiresInSeconds: auth.expiresIn,
    tokenScopeFromCredentialExchange: auth.scope,
    rest: {},
    graphql: null,
    notes: [],
  };

  if (auth.source === "client_credentials" && auth.expiresIn != null) {
    report.notes.push(
      `Token from client_credentials expires in ~${auth.expiresIn}s (Shopify docs: refresh within 24h).`
    );
  }

  console.error(`Auditing ${SHOP} (Admin API ${API_VERSION}, auth: ${auth.source})…\n`);

  report.rest.access_scopes = await restGet(
    oauth,
    "access_scopes",
    "/oauth/access_scopes.json"
  );
  if (!report.rest.access_scopes.ok) {
    report.notes.push(
      "access_scopes.json failed — token may be invalid or URL wrong."
    );
  }

  report.rest.shop = await restGet(rest, "shop", "/shop.json");

  report.graphql = await graphqlQuery(rest, SHOP_GQL);
  if (!report.graphql.ok) {
    report.notes.push(
      "GraphQL shop query failed — check Admin API scopes include shop read access."
    );
  }

  report.rest.locations = await restGet(rest, "locations", "/locations.json?limit=50");
  if (report.rest.locations.status === 403 || report.rest.locations.status === 401) {
    report.notes.push("locations.json skipped or forbidden — add read_locations if needed.");
  }

  report.rest.webhooks = await restGet(rest, "webhooks", "/webhooks.json?limit=50");
  if (report.rest.webhooks.status === 403 || report.rest.webhooks.status === 401) {
    report.notes.push("webhooks.json skipped or forbidden — add read_webhooks if needed.");
  }

  report.rest.policies = await restGet(rest, "policies", "/policies.json");
  if (report.rest.policies.status === 403 || report.rest.policies.status === 401) {
    report.notes.push("policies.json skipped or forbidden — add read_content or related scope.");
  }

  const outPath = path.join(
    process.cwd(),
    `shopify-audit-${SHOP.replace(/\./g, "-")}-${Date.now()}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.error(`\nFull report written to: ${outPath}`);
}

main().catch((err) => {
  sanitizeAxiosError(err);
  console.error(err.message || String(err));
  if (err.code) console.error("Error code:", err.code);
  if (err.response?.status) {
    console.error("HTTP status:", err.response.status);
  }
  process.exit(1);
});
