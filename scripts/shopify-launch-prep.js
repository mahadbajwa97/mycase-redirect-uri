#!/usr/bin/env node
/**
 * Master launch preparation — runs all fix scripts in sequence.
 * Shows a summary dashboard at the end.
 *
 * Run: npm run shopify:launch
 */

const { execSync } = require("child_process");
const path = require("path");

const STEPS = [
  { name: "Full Audit",        script: "shopify-full-audit.js",       desc: "Scan every area of the store" },
  { name: "Fix Policies",      script: "shopify-fix-policies.js",     desc: "Create refund, privacy, ToS, shipping policies" },
  { name: "Fix Pages",         script: "shopify-fix-pages.js",        desc: "Create About, Contact, FAQ, Jewelry Care pages" },
  { name: "Auto-Categorize",   script: "shopify-auto-categorize.js",  desc: "Assign products to collections by type/material/price" },
  { name: "Setup Filters",     script: "shopify-setup-filters.js",    desc: "Add filter tags (Metal, Stone, Type, Style, etc.)" },
  { name: "Fix SEO",           script: "shopify-fix-seo.js",          desc: "Generate SEO titles & descriptions for all products" },
  { name: "Fix Navigation",    script: "shopify-fix-navigation.js",   desc: "Set up main menu and footer with links" },
];

function run(step, index) {
  const total = STEPS.length;
  const scriptPath = path.join(__dirname, step.script);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  STEP ${index + 1}/${total}: ${step.name}`);
  console.log(`  ${step.desc}`);
  console.log(`${"═".repeat(60)}\n`);

  try {
    execSync(`node "${scriptPath}"`, {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
      timeout: 600000,
    });
    return { step: step.name, status: "OK" };
  } catch (err) {
    console.error(`\n  [FAILED] ${step.name}: ${err.message}\n`);
    return { step: step.name, status: "FAILED", error: err.message };
  }
}

function main() {
  console.log(`\n${"╔" + "═".repeat(58) + "╗"}`);
  console.log(`${"║"}  SANA DIAMONDS — LAUNCH PREPARATION                      ${"║"}`);
  console.log(`${"║"}  Running ${STEPS.length} automated fix steps…                          ${"║"}`);
  console.log(`${"╚" + "═".repeat(58) + "╝"}\n`);

  const results = STEPS.map((step, i) => run(step, i));

  console.log(`\n${"═".repeat(60)}`);
  console.log("  LAUNCH PREP SUMMARY");
  console.log(`${"═".repeat(60)}`);
  for (const r of results) {
    const icon = r.status === "OK" ? " ✓ " : " ✗ ";
    console.log(`  [${icon}] ${r.step}: ${r.status}`);
  }
  const failed = results.filter(r => r.status !== "OK").length;
  console.log(`\n  ${results.length - failed}/${results.length} steps succeeded.`);
  if (failed > 0) {
    console.log(`  ${failed} steps failed — review errors above and re-run.`);
  } else {
    console.log(`\n  STORE IS LAUNCH-READY (automated checks passed).`);
    console.log(`\n  MANUAL CHECKS STILL NEEDED:`);
    console.log(`    1. Payment method activated (Settings > Payments)`);
    console.log(`    2. Test checkout with a real card`);
    console.log(`    3. Remove store password (Online Store > Preferences)`);
    console.log(`    4. Enable Search & Discovery filters (Admin > Search & Discovery > Filters)`);
    console.log(`    5. Review theme design (customize > preview)`);
    console.log(`    6. Test on mobile`);
    console.log(`    7. Verify Google Analytics / Meta Pixel if needed`);
  }
  console.log(`${"═".repeat(60)}\n`);
}

main();
