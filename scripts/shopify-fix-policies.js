#!/usr/bin/env node
/**
 * Creates missing store policies via GraphQL Admin API.
 * Policies: Refund, Privacy, Terms of Service, Shipping.
 * Tailored for Sana Diamonds — a US-based jewelry store in Mobile, AL.
 *
 * Run: npm run shopify:fix-policies
 */

const { createClient } = require("./lib/shopify-client");

const POLICIES = {
  REFUND_POLICY: {
    title: "Refund Policy",
    body: `<h2>Returns & Exchanges</h2>
<p>At Sana Diamonds, we want you to love your jewelry. If you're not completely satisfied with your purchase, we offer returns and exchanges within <strong>30 days</strong> of delivery.</p>

<h3>Eligibility</h3>
<ul>
  <li>Items must be in original, unworn condition with all tags and packaging.</li>
  <li>Custom or personalized items (engraved, resized, or special orders) are final sale.</li>
  <li>Items must be returned within 30 days of the delivery date.</li>
</ul>

<h3>How to Initiate a Return</h3>
<ol>
  <li>Email us at <strong>sdsana2020@yahoo.com</strong> with your order number and reason for return.</li>
  <li>We'll provide a prepaid return shipping label (domestic US orders).</li>
  <li>Ship the item back in its original packaging.</li>
</ol>

<h3>Refunds</h3>
<p>Once we receive and inspect your return, we'll process your refund within <strong>5–7 business days</strong> to your original payment method. Shipping costs are non-refundable unless the return is due to our error.</p>

<h3>Exchanges</h3>
<p>If you'd like to exchange for a different size or style, please contact us and we'll arrange the exchange at no additional shipping cost.</p>

<h3>Damaged or Defective Items</h3>
<p>If your item arrives damaged or defective, please contact us within 48 hours of delivery with photos. We'll replace the item or issue a full refund at no cost to you.</p>`,
  },

  PRIVACY_POLICY: {
    title: "Privacy Policy",
    body: `<h2>Privacy Policy</h2>
<p>Sana Diamonds ("we", "us", "our") is committed to protecting your privacy. This policy explains how we collect, use, and safeguard your personal information when you visit <strong>sanadiamonds.com</strong> or make a purchase.</p>

<h3>Information We Collect</h3>
<ul>
  <li><strong>Personal Information:</strong> Name, email, phone number, shipping/billing address when you place an order or create an account.</li>
  <li><strong>Payment Information:</strong> Payment details are processed securely through Shopify Payments and are never stored on our servers.</li>
  <li><strong>Browsing Data:</strong> We use cookies and analytics tools to understand how visitors use our site, including pages visited, time spent, and referring sources.</li>
</ul>

<h3>How We Use Your Information</h3>
<ul>
  <li>Process and fulfill your orders.</li>
  <li>Communicate order updates, shipping notifications, and customer service responses.</li>
  <li>Improve our website, products, and services.</li>
  <li>Send marketing emails (only with your consent — you can unsubscribe anytime).</li>
</ul>

<h3>Information Sharing</h3>
<p>We do not sell your personal information. We share data only with:</p>
<ul>
  <li>Shopify (our e-commerce platform).</li>
  <li>Shipping carriers to deliver your orders.</li>
  <li>Payment processors to complete transactions.</li>
</ul>

<h3>Your Rights</h3>
<p>You may request access to, correction of, or deletion of your personal data by emailing <strong>sdsana2020@yahoo.com</strong>.</p>

<h3>Contact</h3>
<p>For privacy questions: <strong>sdsana2020@yahoo.com</strong> | Sana Diamonds, 6762 Biltmore Court, Mobile, AL 36695</p>`,
  },

  TERMS_OF_SERVICE: {
    title: "Terms of Service",
    body: `<h2>Terms of Service</h2>
<p>Welcome to Sana Diamonds. By accessing or purchasing from <strong>sanadiamonds.com</strong>, you agree to the following terms.</p>

<h3>Products & Pricing</h3>
<ul>
  <li>All prices are listed in USD and are subject to change without notice.</li>
  <li>Product images are representative; natural gemstones and metals may vary slightly in color and appearance.</li>
  <li>We reserve the right to limit quantities or refuse any order.</li>
</ul>

<h3>Orders & Payment</h3>
<ul>
  <li>By placing an order, you confirm that all information provided is accurate.</li>
  <li>We accept major credit cards, debit cards, and Shop Pay through Shopify Payments.</li>
  <li>Orders are confirmed only after payment is successfully processed.</li>
</ul>

<h3>Shipping</h3>
<p>Please refer to our Shipping Policy for delivery timelines, costs, and tracking information.</p>

<h3>Intellectual Property</h3>
<p>All content on this site — including images, text, logos, and designs — is the property of Sana Diamonds and may not be used without written permission.</p>

<h3>Limitation of Liability</h3>
<p>Sana Diamonds is not liable for any indirect, incidental, or consequential damages arising from use of our site or products beyond the purchase price of the item.</p>

<h3>Governing Law</h3>
<p>These terms are governed by the laws of the State of Alabama, United States.</p>

<h3>Contact</h3>
<p><strong>sdsana2020@yahoo.com</strong> | Sana Diamonds, 6762 Biltmore Court, Mobile, AL 36695</p>`,
  },

  SHIPPING_POLICY: {
    title: "Shipping Policy",
    body: `<h2>Shipping Policy</h2>

<h3>Processing Time</h3>
<p>Orders are processed within <strong>1–3 business days</strong>. You'll receive a confirmation email with tracking once your order ships.</p>

<h3>Domestic Shipping (US)</h3>
<ul>
  <li><strong>Standard Shipping:</strong> 5–7 business days — Free on orders over $100.</li>
  <li><strong>Expedited Shipping:</strong> 2–3 business days — available at checkout.</li>
  <li><strong>Overnight Shipping:</strong> Next business day — available at checkout.</li>
</ul>

<h3>International Shipping</h3>
<p>We currently ship within the United States. International shipping may be available upon request — please email us at <strong>sdsana2020@yahoo.com</strong>.</p>

<h3>Insurance & Signature</h3>
<p>All jewelry shipments are fully insured. Orders over $500 require signature confirmation upon delivery.</p>

<h3>Lost or Stolen Packages</h3>
<p>If your package is lost in transit, contact us and we'll work with the carrier to resolve the issue. We are not responsible for packages stolen after delivery confirmation.</p>

<h3>Local Pickup</h3>
<p>Free pickup is available at our store: <strong>Shoppes at Bel Air, 6762 Biltmore Court, Mobile, AL 36695</strong>. Select "Local Pickup" at checkout.</p>`,
  },
};

const UPDATE_POLICY_MUTATION = `
  mutation shopPolicyUpdate($shopPolicy: ShopPolicyInput!) {
    shopPolicyUpdate(shopPolicy: $shopPolicy) {
      shopPolicy {
        id
        type
        body
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function main() {
  const client = await createClient();
  const { gql } = client;

  console.error("Updating store policies…\n");

  for (const [type, policy] of Object.entries(POLICIES)) {
    console.error(`  Setting ${policy.title}…`);
    const result = await gql(UPDATE_POLICY_MUTATION, {
      shopPolicy: { type, body: policy.body },
    });

    const errors = result.data?.shopPolicyUpdate?.userErrors;
    if (errors?.length) {
      console.error(`    ERROR: ${errors.map(e => e.message).join(", ")}`);
    } else {
      console.error(`    Done.`);
    }
  }

  console.error("\nAll policies updated.");
}

main().catch(err => { console.error(err.message); process.exit(1); });
