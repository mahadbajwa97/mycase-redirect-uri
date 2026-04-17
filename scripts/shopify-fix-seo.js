#!/usr/bin/env node
/**
 * Auto-generates SEO titles and descriptions for products missing them.
 * Uses product title, type, tags, price, and vendor to build rich SEO metadata.
 *
 * Run:
 *   npm run shopify:fix-seo -- --dry-run   # preview
 *   npm run shopify:fix-seo                 # apply
 */

const { createClient } = require("./lib/shopify-client");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");

const PRODUCTS_QUERY = `
  query GetProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id title handle productType vendor tags description
          seo { title description }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          variants(first: 1) { edges { node { price } } }
        }
      }
    }
  }
`;

const UPDATE_SEO = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title seo { title description } }
      userErrors { field message }
    }
  }
`;

function generateSeoTitle(product) {
  const parts = [product.title];
  if (product.productType && !product.title.toLowerCase().includes(product.productType.toLowerCase())) {
    parts.push(product.productType);
  }
  parts.push("| Sana Diamonds");
  let title = parts.join(" ");
  if (title.length > 70) title = `${product.title} | Sana Diamonds`;
  if (title.length > 70) title = title.slice(0, 67) + "...";
  return title;
}

function generateSeoDescription(product) {
  const price = product.priceRangeV2?.minVariantPrice?.amount;
  const priceStr = price ? `Starting at $${parseFloat(price).toFixed(2)}.` : "";

  const type = product.productType || "jewelry";
  const vendor = product.vendor && product.vendor !== "Sana Diamonds" ? ` by ${product.vendor}` : "";

  const tags = (product.tags || []).slice(0, 3).join(", ");
  const tagStr = tags ? ` Features: ${tags}.` : "";

  let desc = `Shop ${product.title}${vendor} — premium ${type.toLowerCase()} from Sana Diamonds. ${priceStr}${tagStr} Free shipping on orders over $100. Visit us in Mobile, AL or shop online.`;

  if (desc.length > 160) {
    desc = `Shop ${product.title} — ${type.toLowerCase()} from Sana Diamonds. ${priceStr} Free shipping over $100.`;
  }
  if (desc.length > 160) desc = desc.slice(0, 157) + "...";
  return desc;
}

async function main() {
  const client = await createClient();
  const { SHOP, gql } = client;

  console.error(`SEO audit for ${SHOP}…\n`);

  // Paginate all products
  const products = [];
  let cursor = null;
  while (true) {
    const res = await gql(PRODUCTS_QUERY, { cursor });
    const edges = res.data?.products?.edges || [];
    products.push(...edges.map(e => e.node));
    if (!res.data?.products?.pageInfo?.hasNextPage) break;
    cursor = res.data.products.pageInfo.endCursor;
    await new Promise(r => setTimeout(r, 300));
  }

  console.error(`Found ${products.length} products.\n`);

  const fixes = [];
  for (const p of products) {
    const needsTitle = !p.seo?.title || p.seo.title.trim().length === 0;
    const needsDesc = !p.seo?.description || p.seo.description.trim().length === 0;

    if (!needsTitle && !needsDesc) continue;

    const fix = {
      id: p.id,
      title: p.title,
      currentSeo: p.seo,
      newSeoTitle: needsTitle ? generateSeoTitle(p) : null,
      newSeoDesc: needsDesc ? generateSeoDescription(p) : null,
    };
    fixes.push(fix);
  }

  console.error(`Products needing SEO fixes: ${fixes.length} / ${products.length}\n`);

  if (DRY_RUN) {
    const outPath = path.join(process.cwd(), `shopify-seo-preview-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(fixes, null, 2), "utf8");
    console.error(`[DRY RUN] Preview written to: ${outPath}`);
    console.log(JSON.stringify({ total: products.length, toFix: fixes.length, preview: fixes.slice(0, 10) }, null, 2));
    return;
  }

  let updated = 0;
  for (const fix of fixes) {
    const seo = {};
    if (fix.newSeoTitle) seo.title = fix.newSeoTitle;
    if (fix.newSeoDesc) seo.description = fix.newSeoDesc;

    const res = await gql(UPDATE_SEO, { input: { id: fix.id, seo } });
    const errors = res.data?.productUpdate?.userErrors;
    if (errors?.length) {
      console.error(`  ERROR "${fix.title}": ${errors.map(e => e.message).join(", ")}`);
    } else {
      updated++;
      console.error(`  [${updated}] "${fix.title}" → SEO updated`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.error(`\nDone. ${updated} products updated with SEO metadata.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
