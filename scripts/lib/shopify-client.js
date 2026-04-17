/**
 * Shared Shopify API client — used by all scripts.
 */
require("dotenv").config();
const axios = require("axios");

const DEFAULT_API_VERSION = "2025-10";

function normalizeShop(raw) {
  return (raw || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

async function resolveToken(shop) {
  const direct = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
  if (direct) return direct;

  const clientId = (process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("Missing auth env vars.");

  const res = await axios.post(
    `https://${shop}/admin/oauth/access_token`,
    new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, validateStatus: () => true, timeout: 30000 }
  );
  if (!res.data?.access_token) throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(res.data)}`);
  return res.data.access_token;
}

async function createClient() {
  const SHOP = normalizeShop(process.env.SHOPIFY_SHOP);
  const API_VERSION = (process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim();
  if (!SHOP) throw new Error("Missing SHOPIFY_SHOP");

  const token = await resolveToken(SHOP);
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

  const admin = axios.create({
    baseURL: `https://${SHOP}/admin`,
    headers,
    validateStatus: () => true,
    timeout: 60000,
  });

  async function gql(query, variables = {}) {
    const res = await rest.post("/graphql.json", { query, variables });
    return res.data;
  }

  async function restGet(url) {
    const res = await rest.get(url);
    return { status: res.status, data: res.data, headers: res.headers };
  }

  async function restPost(url, body) {
    const res = await rest.post(url, body);
    return { status: res.status, data: res.data };
  }

  async function restPut(url, body) {
    const res = await rest.put(url, body);
    return { status: res.status, data: res.data };
  }

  async function paginateRest(url, key) {
    const items = [];
    let nextUrl = url;
    while (nextUrl) {
      const res = await rest.get(nextUrl);
      if (res.status !== 200) break;
      items.push(...(res.data[key] || []));
      const link = res.headers?.link?.match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = link ? link[1].replace(/^https?:\/\/[^/]+/, "") : null;
      await new Promise(r => setTimeout(r, 300));
    }
    return items;
  }

  return { SHOP, API_VERSION, token, rest, admin, gql, restGet, restPost, restPut, paginateRest };
}

module.exports = { createClient, normalizeShop };
