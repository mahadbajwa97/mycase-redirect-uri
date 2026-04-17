#!/usr/bin/env node
/**
 * Creates essential store pages if they don't already exist.
 * Pages: About Us, Contact Us, FAQ, Jewelry Care Guide.
 * Tailored for Sana Diamonds.
 *
 * Run: npm run shopify:fix-pages
 */

const { createClient } = require("./lib/shopify-client");

const PAGES = [
  {
    title: "About Us",
    handle: "about",
    body_html: `<h2>Welcome to Sana Diamonds</h2>
<p>Located at the <strong>Shoppes at Bel Air in Mobile, Alabama</strong>, Sana Diamonds is your trusted destination for fine gold, silver, and diamond jewelry.</p>

<p>Founded by <strong>Sana Mangrio</strong>, we bring you a carefully curated selection of engagement rings, wedding bands, necklaces, earrings, bracelets, and more — all at exceptional value.</p>

<h3>Our Promise</h3>
<ul>
  <li><strong>Quality:</strong> Every piece is crafted with genuine metals and stones, certified for authenticity.</li>
  <li><strong>Value:</strong> We believe fine jewelry shouldn't break the bank. Our prices reflect our commitment to affordability.</li>
  <li><strong>Service:</strong> Whether you're shopping in-store or online, our team is here to help you find the perfect piece.</li>
</ul>

<h3>Visit Us</h3>
<p><strong>Sana Diamonds</strong><br>
6762 Biltmore Court<br>
Mobile, AL 36695<br>
Phone: (251) 455-8543<br>
Email: sdsana2020@yahoo.com</p>`,
  },
  {
    title: "Contact Us",
    handle: "contact",
    body_html: `<h2>Get in Touch</h2>
<p>We'd love to hear from you! Whether you have a question about a product, need help with an order, or want to schedule an appointment, reach out anytime.</p>

<h3>Contact Information</h3>
<ul>
  <li><strong>Email:</strong> sdsana2020@yahoo.com</li>
  <li><strong>Phone:</strong> (251) 455-8543</li>
  <li><strong>Address:</strong> 6762 Biltmore Court, Mobile, AL 36695</li>
</ul>

<h3>Business Hours</h3>
<ul>
  <li><strong>Monday – Saturday:</strong> 10:00 AM – 6:00 PM (CST)</li>
  <li><strong>Sunday:</strong> Closed</li>
</ul>

<p>For custom orders, repairs, or special requests, please email us with details and we'll get back to you within 24 hours.</p>`,
  },
  {
    title: "FAQ",
    handle: "faq",
    body_html: `<h2>Frequently Asked Questions</h2>

<h3>Are your diamonds and gemstones real?</h3>
<p>Yes. All diamonds and gemstones sold at Sana Diamonds are genuine unless explicitly stated otherwise (e.g., cubic zirconia or moissanite items are clearly labeled).</p>

<h3>Do you offer ring sizing?</h3>
<p>Yes! We offer free ring sizing on most styles. If you're unsure of your size, visit us in-store or email us for a free sizing guide.</p>

<h3>Can I return or exchange a purchase?</h3>
<p>Absolutely. We accept returns and exchanges within 30 days of delivery. See our <a href="/policies/refund-policy">Refund Policy</a> for full details.</p>

<h3>Do you ship outside of Alabama?</h3>
<p>Yes, we ship to all 50 US states. See our <a href="/policies/shipping-policy">Shipping Policy</a> for delivery times and rates.</p>

<h3>Do you offer financing or layaway?</h3>
<p>We offer Shop Pay installments on qualifying orders. For in-store layaway options, please contact us directly.</p>

<h3>How do I care for my jewelry?</h3>
<p>See our <a href="/pages/jewelry-care">Jewelry Care Guide</a> for tips on keeping your pieces looking their best.</p>

<h3>Can I place a custom order?</h3>
<p>Yes! We work with customers on custom pieces. Email us at sdsana2020@yahoo.com with your vision and budget, and we'll create something special for you.</p>`,
  },
  {
    title: "Jewelry Care Guide",
    handle: "jewelry-care",
    body_html: `<h2>Jewelry Care Guide</h2>
<p>Keep your Sana Diamonds pieces sparkling with these care tips.</p>

<h3>Gold Jewelry</h3>
<ul>
  <li>Clean with warm soapy water and a soft brush. Rinse and dry with a lint-free cloth.</li>
  <li>Remove before swimming, showering, or using harsh chemicals.</li>
  <li>Store in a soft pouch or jewelry box to prevent scratches.</li>
</ul>

<h3>Silver Jewelry</h3>
<ul>
  <li>Polish with a silver polishing cloth to remove tarnish.</li>
  <li>Store in anti-tarnish bags or airtight containers.</li>
  <li>Avoid contact with perfumes, lotions, and sulfur-containing materials.</li>
</ul>

<h3>Diamond & Gemstone Jewelry</h3>
<ul>
  <li>Soak in warm water with mild dish soap for 20–30 minutes, then gently brush with a soft toothbrush.</li>
  <li>Have prong settings checked annually to ensure stones are secure.</li>
  <li>Avoid wearing during heavy physical activity.</li>
</ul>

<h3>General Tips</h3>
<ul>
  <li><strong>Put jewelry on last</strong> — after applying makeup, perfume, and hairspray.</li>
  <li><strong>Remove before bed</strong> to avoid tangling or bending.</li>
  <li><strong>Schedule professional cleanings</strong> at Sana Diamonds — we offer complimentary cleaning for all purchases.</li>
</ul>`,
  },
];

async function main() {
  const client = await createClient();
  const { restGet, restPost } = client;

  console.error("Checking existing pages…");
  const existing = await restGet("/pages.json?limit=250");
  const existingHandles = (existing.data?.pages || []).map(p => p.handle);

  for (const page of PAGES) {
    if (existingHandles.includes(page.handle)) {
      console.error(`  "${page.title}" already exists — skipping.`);
      continue;
    }

    console.error(`  Creating "${page.title}"…`);
    const result = await restPost("/pages.json", { page: { ...page, published: true } });
    if (result.status === 201) {
      console.error(`    Done (id: ${result.data.page.id}).`);
    } else {
      console.error(`    ERROR (${result.status}): ${JSON.stringify(result.data?.errors || result.data)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.error("\nAll pages processed.");
}

main().catch(err => { console.error(err.message); process.exit(1); });
