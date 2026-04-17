#!/usr/bin/env node
/**
 * Sets up main menu and footer navigation via GraphQL Admin API.
 * Uses HTTP links with the store's *primary domain* (e.g. sanadiamonds.com) so
 * PAGE/SHOP_POLICY resource IDs are not required (those mutations reject url-only).
 *
 * Run: npm run shopify:fix-nav
 */

const { createClient } = require("./lib/shopify-client");

const SHOP_QUERY = `
  query NavShop {
    shop {
      primaryDomain { host url sslEnabled }
      myshopifyDomain
    }
  }
`;

const MENU_CREATE = `
  mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu { id title handle }
      userErrors { field message }
    }
  }
`;

const MENU_UPDATE = `
  mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu { id title handle }
      userErrors { field message }
    }
  }
`;

const MENUS_QUERY = `
  query { menus(first: 20) { edges { node { id title handle itemsCount } } } }
`;

const COLLECTIONS_QUERY = `
  query { collections(first: 50, sortKey: TITLE) { edges { node { id title handle } } } }
`;

const PAGES_QUERY = `
  query { pages(first: 50) { edges { node { handle } } } }
`;

function publicBaseUrl(shop, adminShopHost) {
  const host = shop?.primaryDomain?.host;
  if (host) return `https://${host}`;
  return `https://${adminShopHost}`;
}

/** Prefer /pages/about, then /pages/about-us (your store has both). */
function pagePath(handles, candidates) {
  for (const h of candidates) {
    if (handles.has(h)) return `/pages/${h}`;
  }
  return null;
}

function dieOnErrors(res, label) {
  const createErr = res.data?.menuCreate?.userErrors;
  const updateErr = res.data?.menuUpdate?.userErrors;
  const err = (createErr?.length && createErr) || (updateErr?.length && updateErr) || null;
  if (err?.length) {
    const msg = err.map((e) => e.message).join("; ");
    console.error(`    ${label} errors: ${msg}`);
    throw new Error(`${label} failed: ${msg}`);
  }
}

async function main() {
  const client = await createClient();
  const { SHOP, gql } = client;

  console.error(`Setting up navigation for ${SHOP}…\n`);

  const shopRes = await gql(SHOP_QUERY);
  const shop = shopRes.data?.shop;
  const base = publicBaseUrl(shop, SHOP);
  console.error(`  Public URLs will use: ${base}\n`);

  const pagesRes = await gql(PAGES_QUERY);
  const pageHandles = new Set(
    (pagesRes.data?.pages?.edges || []).map((e) => e.node.handle)
  );

  const aboutPath = pagePath(pageHandles, ["about", "about-us"]);
  const contactPath = pagePath(pageHandles, ["contact", "contact-us"]);
  const faqPath = pagePath(pageHandles, ["faq"]);
  const carePath = pagePath(pageHandles, ["jewelry-care"]);

  if (!aboutPath) console.error("  Warning: no About page (handles: about, about-us) — skipping About link.");
  if (!contactPath) console.error("  Warning: no Contact page — skipping Contact link.");
  if (!faqPath) console.error("  Warning: no FAQ page — skipping FAQ link.");

  const menuData = await gql(MENUS_QUERY);
  const menus = menuData.data?.menus?.edges?.map((e) => e.node) || [];
  const existingByHandle = {};
  for (const m of menus) existingByHandle[m.handle] = m;

  const colData = await gql(COLLECTIONS_QUERY);
  const collections = colData.data?.collections?.edges?.map((e) => e.node) || [];

  const shopSubItems = collections.slice(0, 12).map((c) => ({
    title: c.title,
    type: "COLLECTION",
    resourceId: c.id,
  }));

  const mainMenuItems = [
    { title: "Home", type: "FRONTPAGE" },
    {
      title: "Shop",
      type: "HTTP",
      url: `${base}/collections/all`,
      items: shopSubItems,
    },
  ];
  if (aboutPath) mainMenuItems.push({ title: "About Us", type: "HTTP", url: `${base}${aboutPath}` });
  if (contactPath) mainMenuItems.push({ title: "Contact", type: "HTTP", url: `${base}${contactPath}` });
  if (faqPath) mainMenuItems.push({ title: "FAQ", type: "HTTP", url: `${base}${faqPath}` });

  if (existingByHandle["main-menu"]) {
    console.error("  Updating main menu…");
    const res = await gql(MENU_UPDATE, {
      id: existingByHandle["main-menu"].id,
      title: "Main menu",
      items: mainMenuItems,
    });
    dieOnErrors(res, "menuUpdate main-menu");
    console.error("    Updated.");
  } else {
    console.error("  Creating main menu…");
    const res = await gql(MENU_CREATE, { title: "Main menu", handle: "main-menu", items: mainMenuItems });
    dieOnErrors(res, "menuCreate main-menu");
    console.error("    Created.");
  }

  const footerMenuItems = [];
  if (aboutPath) footerMenuItems.push({ title: "About Us", type: "HTTP", url: `${base}${aboutPath}` });
  if (faqPath) footerMenuItems.push({ title: "FAQ", type: "HTTP", url: `${base}${faqPath}` });
  if (carePath) footerMenuItems.push({ title: "Jewelry Care", type: "HTTP", url: `${base}${carePath}` });
  if (contactPath) footerMenuItems.push({ title: "Contact Us", type: "HTTP", url: `${base}${contactPath}` });
  footerMenuItems.push(
    { title: "Refund Policy", type: "HTTP", url: `${base}/policies/refund-policy` },
    { title: "Privacy Policy", type: "HTTP", url: `${base}/policies/privacy-policy` },
    { title: "Terms of Service", type: "HTTP", url: `${base}/policies/terms-of-service` },
    { title: "Shipping Policy", type: "HTTP", url: `${base}/policies/shipping-policy` }
  );

  if (existingByHandle["footer"]) {
    console.error("  Updating footer menu…");
    const res = await gql(MENU_UPDATE, {
      id: existingByHandle["footer"].id,
      title: "Footer menu",
      items: footerMenuItems,
    });
    dieOnErrors(res, "menuUpdate footer");
    console.error("    Updated.");
  } else {
    console.error("  Creating footer menu…");
    const res = await gql(MENU_CREATE, { title: "Footer menu", handle: "footer", items: footerMenuItems });
    dieOnErrors(res, "menuCreate footer");
    console.error("    Created.");
  }

  console.error("\nNavigation setup complete.");
  console.error(`Assign menus in theme: Customize → Header/Footer → Menu → "Main menu" / "Footer menu".`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
