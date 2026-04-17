#!/usr/bin/env node
/**
 * Comprehensive Shopify store audit for launch readiness.
 * Checks every aspect needed for a live jewelry store.
 *
 * Run: npm run shopify:full-audit
 */

const { createClient } = require("./lib/shopify-client");
const fs = require("fs");
const path = require("path");

const SHOP_GQL = `
  query FullAudit {
    shop {
      id name email contactEmail myshopifyDomain url description
      ianaTimezone currencyCode weightUnit taxesIncluded
      checkoutApiSupported enabledPresentmentCurrencies
      plan { displayName partnerDevelopment shopifyPlus }
      primaryDomain { host url sslEnabled }
      billingAddress { address1 address2 city province country zip phone }
    }
  }
`;

const PRODUCTS_COUNT_GQL = `
  query { productsCount { count } }
`;

const COLLECTIONS_GQL = `
  query GetCollections($cursor: String) {
    collections(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges { node { id title handle productsCount { count } ruleSet { rules { column relation condition } } } }
    }
  }
`;

const PAGES_GQL = `
  query { pages(first: 50) { edges { node { id title handle body createdAt } } } }
`;

const BLOGS_GQL = `
  query { blogs(first: 10) { edges { node { id title handle } } } }
`;

const MENUS_GQL = `
  query { menus(first: 10) { edges { node { id title handle itemsCount } } } }
`;

const THEMES_GQL = `
  query { themes(first: 10) { edges { node { id name role } } } }
`;

async function main() {
  const client = await createClient();
  const { SHOP, gql, restGet, paginateRest } = client;

  console.error(`\n=== FULL LAUNCH AUDIT: ${SHOP} ===\n`);

  const audit = {
    generatedAt: new Date().toISOString(),
    shop: null,
    issues: [],
    sections: {},
  };

  function issue(severity, area, message, fix) {
    audit.issues.push({ severity, area, message, fix: fix || null });
    const icon = severity === "critical" ? "!!!" : severity === "warning" ? " ! " : " i ";
    console.error(`  [${icon}] ${area}: ${message}`);
  }

  // ── 1. Shop basics ──────────────────────────────────────────────────────
  console.error("1. Shop basics…");
  const shopData = await gql(SHOP_GQL);
  audit.shop = shopData.data?.shop;
  const s = audit.shop;

  if (!s.description || s.description.length < 20) issue("warning", "Shop", "Store description is missing or too short", "Add a compelling store description in Settings > Store details");
  if (!s.primaryDomain?.sslEnabled) issue("critical", "Shop", "SSL not enabled on primary domain", "Enable SSL in Settings > Domains");
  if (s.enabledPresentmentCurrencies?.length <= 1) issue("info", "Shop", "Only 1 currency (USD) — consider enabling multi-currency if selling internationally");

  // ── 2. Products ──────────────────────────────────────────────────────────
  console.error("2. Products…");
  const prodCount = await gql(PRODUCTS_COUNT_GQL);
  const totalProducts = prodCount.data?.productsCount?.count || 0;
  audit.sections.products = { total: totalProducts };

  if (totalProducts === 0) issue("critical", "Products", "No products in store", "Add products before launch");

  const productSample = await gql(`
    query {
      products(first: 250) {
        edges {
          node {
            id title status productType tags handle
            description
            seo { title description }
            images(first: 1) { edges { node { url } } }
            collections(first: 20) { edges { node { id title } } }
            variants(first: 5) {
              edges {
                node {
                  price compareAtPrice sku barcode inventoryQuantity
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      }
    }
  `);
  const products = productSample.data?.products?.edges?.map(e => e.node) || [];
  const noImages = products.filter(p => !p.images?.edges?.length);
  const noDescription = products.filter(p => !p.description || p.description.trim().length < 10);
  const noSeoTitle = products.filter(p => !p.seo?.title);
  const noSeoDesc = products.filter(p => !p.seo?.description);
  const noType = products.filter(p => !p.productType);
  const noTags = products.filter(p => !p.tags?.length);
  const noCollections = products.filter(p => !p.collections?.edges?.length);
  const noSku = products.filter(p => p.variants?.edges?.some(v => !v.node.sku));
  const zeroInventory = products.filter(p => p.variants?.edges?.every(v => v.node.inventoryQuantity <= 0));
  const drafts = products.filter(p => p.status === "DRAFT");
  const archived = products.filter(p => p.status === "ARCHIVED");

  audit.sections.products = {
    total: totalProducts,
    active: products.filter(p => p.status === "ACTIVE").length,
    draft: drafts.length,
    archived: archived.length,
    noImages: noImages.length,
    noDescription: noDescription.length,
    noSeoTitle: noSeoTitle.length,
    noSeoDesc: noSeoDesc.length,
    noProductType: noType.length,
    noTags: noTags.length,
    noCollections: noCollections.length,
    noSku: noSku.length,
    zeroInventory: zeroInventory.length,
    productsWithoutImages: noImages.map(p => ({ id: p.id, title: p.title })),
    productsWithoutCollections: noCollections.map(p => ({ id: p.id, title: p.title, productType: p.productType })),
    productsWithoutSEO: noSeoTitle.map(p => ({ id: p.id, title: p.title })),
    draftProducts: drafts.map(p => ({ id: p.id, title: p.title })),
  };

  if (noImages.length > 0) issue("critical", "Products", `${noImages.length} products have NO images`, "Upload product photos");
  if (noDescription.length > 0) issue("warning", "Products", `${noDescription.length} products have no/short descriptions`, "Run SEO fixer script");
  if (noSeoTitle.length > 0) issue("warning", "Products/SEO", `${noSeoTitle.length} products missing SEO title`, "Run SEO fixer script");
  if (noSeoDesc.length > 0) issue("warning", "Products/SEO", `${noSeoDesc.length} products missing SEO description`, "Run SEO fixer script");
  if (noType.length > 0) issue("warning", "Products", `${noType.length} products have no product type set`, "Run categorizer script");
  if (noCollections.length > 0) issue("warning", "Products", `${noCollections.length} products not in any collection`, "Run categorizer script");
  if (noSku.length > 0) issue("info", "Products", `${noSku.length} products have variants without SKU`, "Add SKUs for inventory tracking");
  if (zeroInventory.length > 0) issue("warning", "Products", `${zeroInventory.length} products have zero inventory`, "Update inventory or enable overselling");
  if (drafts.length > 0) issue("info", "Products", `${drafts.length} products still in DRAFT`, "Publish or remove drafts before launch");

  // ── 3. Collections ───────────────────────────────────────────────────────
  console.error("3. Collections…");
  let collections = [];
  let colCursor = null;
  while (true) {
    const colData = await gql(COLLECTIONS_GQL, { cursor: colCursor });
    const edges = colData.data?.collections?.edges || [];
    collections.push(...edges.map(e => e.node));
    if (!colData.data?.collections?.pageInfo?.hasNextPage) break;
    colCursor = colData.data.collections.pageInfo.endCursor;
  }
  const emptyCols = collections.filter(c => (c.productsCount?.count || 0) === 0);
  audit.sections.collections = {
    total: collections.length,
    empty: emptyCols.length,
    list: collections.map(c => ({ title: c.title, handle: c.handle, products: c.productsCount?.count || 0 })),
    emptyCollections: emptyCols.map(c => ({ title: c.title, handle: c.handle })),
  };

  if (collections.length === 0) issue("critical", "Collections", "No collections exist — products won't be browsable", "Run categorizer script");
  if (emptyCols.length > 0) issue("info", "Collections", `${emptyCols.length} empty collections`, "Add products or remove empty collections");

  // ── 4. Pages ─────────────────────────────────────────────────────────────
  console.error("4. Pages…");
  const pagesData = await gql(PAGES_GQL);
  const pages = pagesData.data?.pages?.edges?.map(e => e.node) || [];
  audit.sections.pages = {
    total: pages.length,
    list: pages.map(p => ({ title: p.title, handle: p.handle, hasContent: !!p.body && p.body.length > 20 })),
  };

  const essentialPages = ["about", "contact", "faq"];
  const existingHandles = pages.map(p => p.handle.toLowerCase());
  const missingPages = essentialPages.filter(h => !existingHandles.some(eh => eh.includes(h)));

  if (missingPages.length > 0) issue("warning", "Pages", `Missing essential pages: ${missingPages.join(", ")}`, "Run page creator script");

  // ── 5. Navigation / Menus ────────────────────────────────────────────────
  console.error("5. Navigation menus…");
  const menuData = await gql(MENUS_GQL);
  const menus = menuData.data?.menus?.edges?.map(e => e.node) || [];
  audit.sections.menus = {
    total: menus.length,
    list: menus.map(m => ({ title: m.title, handle: m.handle, items: m.itemsCount })),
  };

  if (menus.length === 0) issue("critical", "Navigation", "No navigation menus configured", "Run navigation setup script");
  const mainMenu = menus.find(m => m.handle === "main-menu" || m.title.toLowerCase().includes("main"));
  const footerMenu = menus.find(m => m.handle === "footer" || m.title.toLowerCase().includes("footer"));
  if (!mainMenu) issue("warning", "Navigation", "No main menu found", "Create main navigation");
  if (!footerMenu) issue("warning", "Navigation", "No footer menu found", "Create footer navigation");

  // ── 6. Policies ──────────────────────────────────────────────────────────
  console.error("6. Store policies…");
  const polData = await restGet("/policies.json");
  const policies = polData.data?.policies || [];
  audit.sections.policies = {
    total: policies.length,
    list: policies.map(p => ({ title: p.title, handle: p.handle, hasContent: !!p.body && p.body.length > 50 })),
  };

  const policyTypes = ["refund-policy", "privacy-policy", "terms-of-service", "shipping-policy"];
  const existingPolicies = policies.map(p => p.handle);
  const missingPolicies = policyTypes.filter(pt => !existingPolicies.includes(pt));

  if (missingPolicies.length > 0) issue("critical", "Policies", `Missing: ${missingPolicies.join(", ")}`, "Create policies via Admin or run policy setup script");

  // ── 7. Blogs ─────────────────────────────────────────────────────────────
  console.error("7. Blogs…");
  const blogData = await gql(BLOGS_GQL);
  const blogs = blogData.data?.blogs?.edges?.map(e => e.node) || [];
  audit.sections.blogs = { total: blogs.length, list: blogs.map(b => ({ title: b.title, handle: b.handle })) };

  // ── 8. Themes ────────────────────────────────────────────────────────────
  console.error("8. Themes…");
  const themeData = await gql(THEMES_GQL);
  const themes = themeData.data?.themes?.edges?.map(e => e.node) || [];
  audit.sections.themes = { list: themes.map(t => ({ name: t.name, role: t.role })) };

  // ── 9. Webhooks ──────────────────────────────────────────────────────────
  console.error("9. Webhooks…");
  const whData = await restGet("/webhooks.json?limit=50");
  const webhooks = whData.data?.webhooks || [];
  audit.sections.webhooks = { total: webhooks.length, list: webhooks.map(w => ({ topic: w.topic, address: w.address })) };

  if (webhooks.length === 0) issue("info", "Webhooks", "No webhooks registered — order/inventory notifications won't trigger", "Set up webhooks if integrating with external systems");

  // ── 10. Shipping ─────────────────────────────────────────────────────────
  console.error("10. Shipping zones…");
  const shipData = await restGet("/shipping_zones.json");
  const zones = shipData.data?.shipping_zones || [];
  audit.sections.shipping = {
    total: zones.length,
    zones: zones.map(z => ({
      name: z.name,
      countries: z.countries?.map(c => c.code) || [],
      rateCount: (z.price_based_shipping_rates?.length || 0) + (z.weight_based_shipping_rates?.length || 0) + (z.carrier_shipping_rate_providers?.length || 0),
    })),
  };

  if (zones.length === 0) issue("critical", "Shipping", "No shipping zones configured — customers can't checkout", "Set up shipping in Settings > Shipping");
  for (const z of zones) {
    const rateCount = (z.price_based_shipping_rates?.length || 0) + (z.weight_based_shipping_rates?.length || 0) + (z.carrier_shipping_rate_providers?.length || 0);
    if (rateCount === 0) issue("warning", "Shipping", `Zone "${z.name}" has no shipping rates`, "Add at least one rate to each zone");
  }

  // ── 11. Payment (via shop data) ──────────────────────────────────────────
  console.error("11. Payment readiness…");
  const shopRest = await restGet("/shop.json");
  const shopObj = shopRest.data?.shop;
  audit.sections.payment = {
    eligibleForPayments: shopObj?.eligible_for_payments,
    passwordEnabled: shopObj?.password_enabled,
    setupRequired: shopObj?.setup_required,
    hasStorefront: shopObj?.has_storefront,
  };

  if (!shopObj?.eligible_for_payments) issue("critical", "Payments", "Store not eligible for payments", "Complete payment setup in Settings > Payments");
  if (shopObj?.password_enabled) issue("warning", "Storefront", "Store is password-protected — visitors can't browse", "Remove password in Online Store > Preferences");
  if (shopObj?.setup_required) issue("critical", "Setup", "Shopify indicates store setup is incomplete", "Complete guided setup in admin");

  // ── 12. Locations / inventory ────────────────────────────────────────────
  console.error("12. Locations…");
  const locData = await restGet("/locations.json");
  const locations = locData.data?.locations || [];
  audit.sections.locations = { total: locations.length, list: locations.map(l => ({ name: l.name, active: l.active, city: l.city })) };

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  const critical = audit.issues.filter(i => i.severity === "critical").length;
  const warnings = audit.issues.filter(i => i.severity === "warning").length;
  const info = audit.issues.filter(i => i.severity === "info").length;

  audit.summary = {
    launchReady: critical === 0,
    critical,
    warnings,
    info,
    totalIssues: audit.issues.length,
  };

  console.error(`\n=== AUDIT SUMMARY ===`);
  console.error(`  Critical: ${critical}`);
  console.error(`  Warnings: ${warnings}`);
  console.error(`  Info:     ${info}`);
  console.error(`  Launch ready: ${critical === 0 ? "YES" : "NO"}\n`);

  const outPath = path.join(process.cwd(), `shopify-full-audit-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(audit, null, 2), "utf8");
  console.log(JSON.stringify(audit, null, 2));
  console.error(`Full audit written to: ${outPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
