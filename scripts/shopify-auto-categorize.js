#!/usr/bin/env node
/**
 * Auto-categorize Sana Diamonds products by analyzing title, tags, productType.
 *
 * Step 1 (--dry-run): prints what category each product WOULD be assigned.
 * Step 2 (default):   creates Custom Collections if missing, then adds products.
 *
 * Run:
 *   node scripts/shopify-auto-categorize.js --dry-run   # preview only
 *   node scripts/shopify-auto-categorize.js              # apply changes
 *
 * Required .env: SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
 *                (or SHOPIFY_ACCESS_TOKEN)
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");
const DEFAULT_API_VERSION = "2025-10";

function normalizeShop(raw) {
  return (raw || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

async function resolveToken() {
  const direct = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
  if (direct) return direct;
  const clientId = (process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
  const SHOP = normalizeShop(process.env.SHOPIFY_SHOP);
  const res = await axios.post(
    `https://${SHOP}/admin/oauth/access_token`,
    new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, validateStatus: () => true, timeout: 30000 }
  );
  if (!res.data?.access_token) throw new Error(`Token failed: ${JSON.stringify(res.data)}`);
  return res.data.access_token;
}

// ─── CATEGORY RULES (jewelry-specific for Sana Diamonds) ────────────────────
// Order matters: first matching rule wins for primary category.
// Each product can also get secondary "material" and "price band" labels.

/** Map Shopify product_type (normalized) to your Custom Collection title. */
const PRODUCT_TYPE_TO_COLLECTION = {
  bracelet: "Bracelets",
  bangle: "Bangle",
  necklace: "Necklaces",
  pendant: "Pendants",
  ring: "Rings",
  band: "Band",
  earrings: "Earrings",
  earring: "Earrings",
  chain: "Chains",
  "bridal set": "Bridal Set",
  "bridal-set": "Bridal Set",
};

const JEWELRY_CATEGORIES = [
  // Type rules — matched against lowercased title + tags + productType
  { name: "Rings",        handles: ["ring", "band", "solitaire", "engagement", "wedding ring", "cocktail ring"] },
  { name: "Necklaces",    handles: ["necklace", "choker", "lariat", "collar necklace"] },
  { name: "Pendants",     handles: ["pendant", "charm necklace", "locket"] },
  { name: "Chains",       handles: ["chain", "rope chain", "box chain", "figaro", "cuban link", "miami cuban", "franco", "cable chain"] },
  { name: "Earrings",     handles: ["earring", "stud", "hoop", "drop earring", "ear cuff", "huggie", "dangle"] },
  { name: "Bracelets",    handles: ["bracelet", "bangle", "cuff", "tennis bracelet", "charm bracelet"] },
  { name: "Anklets",      handles: ["anklet", "ankle bracelet"] },
  { name: "Sets",         handles: ["set", "suite", "bundle", "collection set"] },
  { name: "Watches",      handles: ["watch", "timepiece"] },
  { name: "Accessories",  handles: ["keychain", "money clip", "pin", "brooch", "clip"] },
];

const MATERIAL_CATEGORIES = [
  { name: "Diamond Jewelry",    handles: ["diamond", "moissanite", "brilliant", "carat", "ct"] },
  { name: "Gold Jewelry",       handles: ["gold", "14k", "18k", "10k", "yellow gold", "white gold", "rose gold", "karat"] },
  { name: "Silver Jewelry",     handles: ["silver", "sterling", "925", ".925"] },
  { name: "Gemstone Jewelry",   handles: ["ruby", "emerald", "sapphire", "amethyst", "topaz", "opal", "pearl", "turquoise", "garnet", "aquamarine", "peridot", "citrine", "tanzanite", "gemstone", "gem"] },
  { name: "Cubic Zirconia",     handles: ["cz", "cubic zirconia", "cubic"] },
];

const PRICE_BANDS = [
  { name: "Under $50",        max: 50 },
  { name: "$50 – $150",       min: 50,  max: 150 },
  { name: "$150 – $500",      min: 150, max: 500 },
  { name: "$500 – $1,000",    min: 500, max: 1000 },
  { name: "Over $1,000",      min: 1000 },
];

function searchable(product) {
  return [product.title, product.productType, ...(product.tags || [])].join(" ").toLowerCase();
}

function assignCategories(product) {
  const text = searchable(product);
  const price = parseFloat(product.variants?.[0]?.price || 0);

  let primaryType = null;
  const pt = (product.product_type || "").trim().toLowerCase();
  if (pt && PRODUCT_TYPE_TO_COLLECTION[pt]) {
    primaryType = PRODUCT_TYPE_TO_COLLECTION[pt];
  }
  if (!primaryType) {
    for (const cat of JEWELRY_CATEGORIES) {
      if (cat.handles.some((h) => text.includes(h))) {
        primaryType = cat.name;
        break;
      }
    }
  }

  const materials = MATERIAL_CATEGORIES.filter(cat => cat.handles.some(h => text.includes(h))).map(c => c.name);

  let priceBand = null;
  for (const band of PRICE_BANDS) {
    const aboveMin = band.min == null || price >= band.min;
    const belowMax = band.max == null || price < band.max;
    if (aboveMin && belowMax) { priceBand = band.name; break; }
  }

  return { primaryType, materials, priceBand };
}

// ─── SHOPIFY REST HELPERS ────────────────────────────────────────────────────

async function getAllProducts(client) {
  const products = [];
  let link = "/products.json?limit=250&fields=id,title,product_type,tags,variants,status";
  while (link) {
    const res = await client.get(link);
    if (res.status !== 200) throw new Error(`GET products failed: ${res.status}`);
    products.push(...(res.data.products || []));
    const nextMatch = res.headers?.link?.match(/<([^>]+)>;\s*rel="next"/);
    link = nextMatch ? nextMatch[1].replace(`https://${client.defaults.baseURL?.match(/([^/]+)/)?.[0]}`, "") : null;
    await new Promise(r => setTimeout(r, 300));
  }
  return products;
}

async function getAllCollections(client) {
  const res = await client.get("/custom_collections.json?limit=250");
  return res.data?.custom_collections || [];
}

async function createCollection(client, title) {
  const body = {
    custom_collection: {
      title,
      published: true,
      sort_order: "best-selling",
    }
  };
  const res = await client.post("/custom_collections.json", body);
  if (res.status !== 201) throw new Error(`Create collection "${title}" failed: ${res.status} ${JSON.stringify(res.data)}`);
  console.error(`  Created collection: "${title}" (id: ${res.data.custom_collection.id})`);
  return res.data.custom_collection;
}

async function addProductToCollection(client, collectionId, productId) {
  const body = { collect: { collection_id: collectionId, product_id: productId } };
  const res = await client.post("/collects.json", body);
  if (res.status !== 201 && res.status !== 422) { // 422 = already in collection
    throw new Error(`Add product ${productId} to ${collectionId} failed: ${res.status}`);
  }
}

async function getCollectsForProduct(client, productId) {
  const res = await client.get(`/collects.json?product_id=${productId}`);
  return (res.data?.collects || []).map(c => c.collection_id);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

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

  console.error(`Pulling products from ${SHOP}…`);
  const products = await getAllProducts(client);
  console.error(`Found ${products.length} products.`);

  // Classify every product
  const classified = products.map(p => ({
    ...p,
    _assigned: assignCategories(p),
    _currentCollectionIds: [],
  }));

  // Determine all unique category names needed
  const neededCategories = new Set();
  for (const p of classified) {
    if (p._assigned.primaryType) neededCategories.add(p._assigned.primaryType);
    for (const m of p._assigned.materials) neededCategories.add(m);
    if (p._assigned.priceBand) neededCategories.add(p._assigned.priceBand);
  }

  // Build summary for dry run
  const preview = classified.map(p => ({
    id: p.id,
    title: p.title,
    currentTags: p.tags,
    productType: p.product_type,
    willAssign: p._assigned,
  }));

  const summary = {
    total: products.length,
    categoriesNeeded: [...neededCategories].sort(),
    byPrimaryType: {},
    uncategorizable: [],
  };
  for (const p of classified) {
    if (!p._assigned.primaryType) {
      summary.uncategorizable.push({ id: p.id, title: p.title, productType: p.product_type, tags: p.tags });
    } else {
      summary.byPrimaryType[p._assigned.primaryType] = (summary.byPrimaryType[p._assigned.primaryType] || 0) + 1;
    }
  }

  console.log("\n=== CATEGORIZATION PREVIEW ===");
  console.log(JSON.stringify(summary, null, 2));

  if (DRY_RUN) {
    const outPath = path.join(process.cwd(), `shopify-categorize-preview-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ summary, preview }, null, 2), "utf8");
    console.error(`\n[DRY RUN] No changes made. Preview written to: ${outPath}`);
    console.error(`Re-run without --dry-run to apply changes.`);
    return;
  }

  // ─── Apply changes ───────────────────────────────────────────────────────
  console.error("\nApplying changes to Shopify…");

  const existingCollections = await getAllCollections(client);
  const collectionMap = {};
  for (const c of existingCollections) collectionMap[c.title] = c;

  // Create any missing collections
  for (const name of neededCategories) {
    if (!collectionMap[name]) {
      if (!DRY_RUN) {
        const created = await createCollection(client, name);
        collectionMap[name] = created;
        await new Promise(r => setTimeout(r, 400));
      }
    } else {
      console.error(`  Collection already exists: "${name}"`);
    }
  }

  // Add products to their collections
  let updated = 0;
  let skipped = 0;
  for (const p of classified) {
    const { primaryType, materials, priceBand } = p._assigned;
    const toAssign = [primaryType, ...materials, priceBand].filter(Boolean);

    if (toAssign.length === 0) { skipped++; continue; }

    const existingColIds = await getCollectsForProduct(client, p.id);
    let changed = false;

    for (const catName of toAssign) {
      const col = collectionMap[catName];
      if (!col) continue;
      if (existingColIds.includes(col.id)) continue;
      await addProductToCollection(client, col.id, p.id);
      changed = true;
      await new Promise(r => setTimeout(r, 150));
    }

    if (changed) {
      updated++;
      console.error(`  [${updated}] Assigned "${p.title}" → ${toAssign.join(", ")}`);
    } else {
      skipped++;
    }
  }

  const outPath = path.join(process.cwd(), `shopify-categorize-result-${Date.now()}.json`);
  const result = { generatedAt: new Date().toISOString(), summary, updated, skipped, preview };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.error(`\nDone. ${updated} products updated, ${skipped} skipped.`);
  console.error(`Full result: ${outPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
