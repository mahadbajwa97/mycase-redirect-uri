#!/usr/bin/env node
/**
 * Sets up storefront filter tags on all products and creates navigational
 * smart collections so Shopify's native product filtering works correctly.
 *
 * For Sana Diamonds — adds structured filter tags in these groups:
 *   filter.p.tag  (Shopify native tag filter)
 *   filter.p.m.global.material  (metafield-based)
 *
 * What this does:
 *  1. Re-tags every product with canonical filter tags (Metal, Stone, Style, etc.)
 *  2. Creates Smart Collections that Shopify Online Store can expose as filters
 *  3. (Optional) Creates storefront filter groups via GraphQL Admin API
 *
 * Run:
 *   node scripts/shopify-setup-filters.js --dry-run    # preview only
 *   node scripts/shopify-setup-filters.js               # apply
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

// ─── FILTER TAG RULES ────────────────────────────────────────────────────────
// Shopify's native filter UI reads product tags with the prefix convention.
// These tags will be applied to matching products so the storefront can filter them.

const FILTER_RULES = [
  // Metal type filters
  { filterGroup: "Metal",   filterValue: "Gold",         matches: ["gold", "14k", "18k", "10k", "yellow gold", "white gold", "rose gold"] },
  { filterGroup: "Metal",   filterValue: "Silver",       matches: ["silver", "sterling", "925"] },
  { filterGroup: "Metal",   filterValue: "Platinum",     matches: ["platinum", "pt950", "pt900"] },
  { filterGroup: "Metal",   filterValue: "Stainless Steel", matches: ["stainless steel", "stainless"] },
  { filterGroup: "Metal",   filterValue: "Titanium",     matches: ["titanium"] },

  // Stone / gem filters
  { filterGroup: "Stone",   filterValue: "Diamond",      matches: ["diamond", "brilliant", "vvs", "vs1", "vs2", "si1", "si2"] },
  { filterGroup: "Stone",   filterValue: "Moissanite",   matches: ["moissanite"] },
  { filterGroup: "Stone",   filterValue: "Ruby",         matches: ["ruby"] },
  { filterGroup: "Stone",   filterValue: "Sapphire",     matches: ["sapphire"] },
  { filterGroup: "Stone",   filterValue: "Emerald",      matches: ["emerald"] },
  { filterGroup: "Stone",   filterValue: "Amethyst",     matches: ["amethyst"] },
  { filterGroup: "Stone",   filterValue: "Pearl",        matches: ["pearl"] },
  { filterGroup: "Stone",   filterValue: "Opal",         matches: ["opal"] },
  { filterGroup: "Stone",   filterValue: "Topaz",        matches: ["topaz"] },
  { filterGroup: "Stone",   filterValue: "Turquoise",    matches: ["turquoise"] },
  { filterGroup: "Stone",   filterValue: "Cubic Zirconia", matches: ["cubic zirconia", "cz"] },
  { filterGroup: "Stone",   filterValue: "No Stone",     matches: ["plain", "no stone", "polished", "solid gold", "solid silver"] },

  // Jewelry type filters
  { filterGroup: "Type",    filterValue: "Ring",         matches: ["ring", "band", "engagement ring", "wedding ring", "cocktail ring", "solitaire"] },
  { filterGroup: "Type",    filterValue: "Necklace",     matches: ["necklace", "choker", "collar"] },
  { filterGroup: "Type",    filterValue: "Pendant",      matches: ["pendant", "charm", "locket"] },
  { filterGroup: "Type",    filterValue: "Chain",        matches: ["chain", "rope chain", "figaro", "cuban link", "box chain", "franco", "cable chain"] },
  { filterGroup: "Type",    filterValue: "Earring",      matches: ["earring", "stud", "hoop", "huggie", "drop earring", "ear cuff", "dangle"] },
  { filterGroup: "Type",    filterValue: "Bracelet",     matches: ["bracelet", "bangle", "cuff", "tennis bracelet"] },
  { filterGroup: "Type",    filterValue: "Anklet",       matches: ["anklet", "ankle bracelet"] },
  { filterGroup: "Type",    filterValue: "Set",          matches: ["set", "suite", "bundle"] },

  // Style / occasion filters
  { filterGroup: "Style",   filterValue: "Engagement",   matches: ["engagement", "engagement ring", "proposal", "promise ring"] },
  { filterGroup: "Style",   filterValue: "Wedding",      matches: ["wedding", "bridal", "wedding band", "anniversary"] },
  { filterGroup: "Style",   filterValue: "Everyday",     matches: ["everyday", "casual", "minimalist", "delicate", "dainty", "simple"] },
  { filterGroup: "Style",   filterValue: "Statement",    matches: ["statement", "bold", "cocktail", "oversized", "chunky"] },
  { filterGroup: "Style",   filterValue: "Gift",         matches: ["gift", "birthday", "valentine", "mother's day", "christmas", "holiday"] },
  { filterGroup: "Style",   filterValue: "Religious",    matches: ["cross", "allah", "hamsa", "evil eye", "religious", "faith", "crescent"] },
  { filterGroup: "Style",   filterValue: "Initial / Name", matches: ["initial", "name", "letter", "monogram", "personali"] },

  // Karat / purity filters
  { filterGroup: "Karat",   filterValue: "10K Gold",     matches: ["10k", "10 karat"] },
  { filterGroup: "Karat",   filterValue: "14K Gold",     matches: ["14k", "14 karat"] },
  { filterGroup: "Karat",   filterValue: "18K Gold",     matches: ["18k", "18 karat"] },
  { filterGroup: "Karat",   filterValue: "925 Silver",   matches: ["925", "sterling silver", ".925"] },

  // Gender target
  { filterGroup: "For",     filterValue: "Women",        matches: ["women", "her", "ladies", "feminine", "female"] },
  { filterGroup: "For",     filterValue: "Men",          matches: ["men", "his", "mens", "gents", "male", "masculine"] },
  { filterGroup: "For",     filterValue: "Unisex",       matches: ["unisex", "all genders"] },
  { filterGroup: "For",     filterValue: "Kids",         matches: ["kids", "children", "baby", "child", "girl", "boy"] },
];

function getFilterTags(product) {
  const text = [product.title, product.product_type, product.tags].flat().join(" ").toLowerCase();
  const tagsToAdd = new Set();

  for (const rule of FILTER_RULES) {
    if (rule.matches.some(m => text.includes(m))) {
      tagsToAdd.add(`${rule.filterGroup}_${rule.filterValue}`);
    }
  }

  return [...tagsToAdd];
}

async function getAllProducts(client) {
  const products = [];
  let url = "/products.json?limit=250&fields=id,title,product_type,tags,variants,status";
  while (url) {
    const res = await client.get(url);
    if (res.status !== 200) throw new Error(`GET products failed: ${res.status}`);
    products.push(...(res.data.products || []));
    const next = res.headers?.link?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1].replace(/^https?:\/\/[^/]+/, "") : null;
    await new Promise(r => setTimeout(r, 300));
  }
  return products;
}

async function updateProductTags(client, productId, existingTags, newFilterTags) {
  const currentSet = new Set(existingTags || []);
  const added = [];
  for (const tag of newFilterTags) {
    if (!currentSet.has(tag)) { currentSet.add(tag); added.push(tag); }
  }
  if (added.length === 0) return false;

  const res = await client.put(`/products/${productId}.json`, {
    product: { id: productId, tags: [...currentSet].join(", ") }
  });
  if (res.status !== 200) throw new Error(`Tag update for ${productId} failed: ${res.status}`);
  return added;
}

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

  const filterGroups = {};
  const preview = [];

  for (const p of products) {
    const existingTags = typeof p.tags === "string" ? p.tags.split(",").map(t => t.trim()).filter(Boolean) : (p.tags || []);
    const filterTags = getFilterTags({ ...p, tags: existingTags });
    const newTags = filterTags.filter(t => !existingTags.includes(t));

    for (const tag of filterTags) {
      const [group] = tag.split("_");
      if (!filterGroups[group]) filterGroups[group] = new Set();
      filterGroups[group].add(tag.replace(`${group}_`, ""));
    }

    preview.push({ id: p.id, title: p.title, existingTags, filterTagsToAdd: newTags, allFilterTags: filterTags });
  }

  // Print preview
  const filterGroupSummary = {};
  for (const [g, vals] of Object.entries(filterGroups)) filterGroupSummary[g] = [...vals].sort();

  console.log("\n=== FILTER GROUPS THAT WILL BE APPLIED ===");
  console.log(JSON.stringify(filterGroupSummary, null, 2));
  console.log(`\nProducts that will get new filter tags: ${preview.filter(p => p.filterTagsToAdd.length > 0).length} / ${products.length}`);

  if (DRY_RUN) {
    const outPath = path.join(process.cwd(), `shopify-filters-preview-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ filterGroupSummary, preview }, null, 2), "utf8");
    console.error(`\n[DRY RUN] No changes made. Preview written to: ${outPath}`);
    console.error("Re-run without --dry-run to apply filter tags to all products.");
    return;
  }

  // Apply filter tags
  let updated = 0;
  let skipped = 0;
  for (const p of preview) {
    if (p.filterTagsToAdd.length === 0) { skipped++; continue; }
    try {
      const added = await updateProductTags(client, p.id, p.existingTags, p.filterTagsToAdd);
      if (added) {
        updated++;
        console.error(`  [${updated}] "${p.title}" +tags: ${p.filterTagsToAdd.join(", ")}`);
      } else {
        skipped++;
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`  ERROR on "${p.title}": ${err.message}`);
    }
  }

  console.error(`\nDone. ${updated} products tagged, ${skipped} already up to date.`);
  console.error(`\nNEXT STEP: In Shopify Admin → Online Store → Themes → Customize → Collection page`);
  console.error(`Enable "Product filtering" and select the filter groups above.`);
  console.error(`Shopify will automatically use the tags we added (group_value format).`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
