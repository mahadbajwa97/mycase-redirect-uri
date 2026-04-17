#!/usr/bin/env node
/**
 * Pull every product + its collections/tags and write a product catalog JSON.
 * Uses GraphQL cursor pagination — handles any number of products safely.
 *
 * Required .env:
 *   SHOPIFY_SHOP=885499-3.myshopify.com
 *   SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  (or SHOPIFY_ACCESS_TOKEN)
 *
 * Run: npm run shopify:products
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DEFAULT_API_VERSION = "2025-10";
const PAGE_SIZE = 50;

function normalizeShop(raw) {
  return (raw || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

async function resolveToken() {
  const direct = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
  if (direct) return direct;

  const clientId = (process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("Missing auth env vars.");

  const res = await axios.post(
    `https://${normalizeShop(process.env.SHOPIFY_SHOP)}/admin/oauth/access_token`,
    new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, validateStatus: () => true, timeout: 30000 }
  );
  if (!res.data?.access_token) throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(res.data)}`);
  return res.data.access_token;
}

const PRODUCTS_QUERY = `
  query GetProducts($cursor: String) {
    products(first: ${PAGE_SIZE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          status
          productType
          vendor
          tags
          description
          totalInventory
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          images(first: 1) {
            edges { node { url altText } }
          }
          collections(first: 20) {
            edges { node { id title handle } }
          }
          variants(first: 5) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                selectedOptions { name value }
              }
            }
          }
          metafields(first: 10) {
            edges { node { namespace key value type } }
          }
        }
      }
    }
  }
`;

async function main() {
  const SHOP = normalizeShop(process.env.SHOPIFY_SHOP);
  const API_VERSION = (process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION).trim();

  if (!SHOP) { console.error("Missing SHOPIFY_SHOP"); process.exit(1); }

  const token = await resolveToken();
  const client = axios.create({
    baseURL: `https://${SHOP}/admin/api/${API_VERSION}`,
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    validateStatus: () => true,
    timeout: 60000,
  });

  const products = [];
  let cursor = null;
  let page = 1;

  while (true) {
    process.stderr.write(`\rFetching page ${page} (${products.length} products so far)…`);
    const res = await client.post("/graphql.json", { query: PRODUCTS_QUERY, variables: { cursor } });

    if (res.status !== 200 || res.data.errors) {
      console.error("\nGraphQL error:", JSON.stringify(res.data.errors || res.data, null, 2));
      process.exit(1);
    }

    const { edges, pageInfo } = res.data.data.products;
    for (const { node } of edges) {
      products.push({
        id: node.id,
        numericId: node.id.replace("gid://shopify/Product/", ""),
        title: node.title,
        handle: node.handle,
        status: node.status,
        productType: node.productType || "",
        vendor: node.vendor || "",
        tags: node.tags || [],
        description: (node.description || "").slice(0, 300),
        totalInventory: node.totalInventory,
        minPrice: parseFloat(node.priceRangeV2?.minVariantPrice?.amount || 0),
        maxPrice: parseFloat(node.priceRangeV2?.maxVariantPrice?.amount || 0),
        image: node.images?.edges?.[0]?.node?.url || null,
        collections: node.collections?.edges?.map(e => ({ id: e.node.id, title: e.node.title, handle: e.node.handle })) || [],
        variants: node.variants?.edges?.map(e => ({
          id: e.node.id,
          title: e.node.title,
          sku: e.node.sku,
          price: e.node.price,
          compareAtPrice: e.node.compareAtPrice,
          inventory: e.node.inventoryQuantity,
          options: e.node.selectedOptions,
        })) || [],
        metafields: node.metafields?.edges?.map(e => ({ namespace: e.node.namespace, key: e.node.key, value: e.node.value, type: e.node.type })) || [],
      });
    }

    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
    page++;
    await new Promise(r => setTimeout(r, 300)); // polite rate limiting
  }

  process.stderr.write(`\nDone — ${products.length} products fetched.\n`);

  // --- Analysis ---
  const uncategorized = products.filter(p => p.collections.length === 0);
  const byProductType = {};
  const byVendor = {};
  const allTags = {};
  const allCollections = {};

  for (const p of products) {
    const t = p.productType || "(none)";
    byProductType[t] = (byProductType[t] || 0) + 1;

    const v = p.vendor || "(none)";
    byVendor[v] = (byVendor[v] || 0) + 1;

    for (const tag of p.tags) allTags[tag] = (allTags[tag] || 0) + 1;
    for (const col of p.collections) allCollections[col.title] = (allCollections[col.title] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    shopDomain: SHOP,
    summary: {
      total: products.length,
      active: products.filter(p => p.status === "ACTIVE").length,
      draft: products.filter(p => p.status === "DRAFT").length,
      archived: products.filter(p => p.status === "ARCHIVED").length,
      uncategorized: uncategorized.length,
      byProductType: Object.entries(byProductType).sort((a,b) => b[1]-a[1]),
      byVendor: Object.entries(byVendor).sort((a,b) => b[1]-a[1]),
      topTags: Object.entries(allTags).sort((a,b) => b[1]-a[1]).slice(0, 30),
      existingCollections: Object.entries(allCollections).sort((a,b) => b[1]-a[1]),
    },
    uncategorizedProducts: uncategorized.map(p => ({ id: p.numericId, title: p.title, productType: p.productType, tags: p.tags, price: p.minPrice })),
    products,
  };

  const outPath = path.join(process.cwd(), `shopify-products-${SHOP.replace(/\./g,"-")}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report.summary, null, 2));
  console.error(`\nFull catalog written to: ${outPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
