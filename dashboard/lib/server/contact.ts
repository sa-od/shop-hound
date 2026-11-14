import type { Platform } from './platform';

/**
 * Where users are sent when we can't read a store automatically: they email
 * the team, who read it by hand, send the analysis, and keep tracking it
 * weekly like any other store. Set CONTACT_EMAIL to change the address
 * without a code change.
 */
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL?.trim() || 'sahoodhkr@gmail.com';

/** AI reading of stores with no catalogue file (Firecrawl, ~50 credits each). Off unless AI_READ=on. */
export const aiReadEnabled = (): boolean => process.env.AI_READ === 'on';

/** Everything the UI needs to show a manual-read store and its email action. */
export interface ManualRead {
  platform: Platform['id'];
  platformName: string;
  /** Shown to the user as-is: why we can't read it, and what happens when they email. */
  message: string;
  /**
   * mailto: opens the user's default mail app; gmail: opens the same email,
   * filled in, in Gmail's web compose window (for people without a mail app
   * set up, which is common on desktops).
   */
  email: { to: string; subject: string; body: string; mailto: string; gmail: string };
}

function why(store: string, p: Platform): string {
  switch (p.id) {
    case 'shopify_headless':
      return `${store} is built on Shopify but uses a custom storefront, so its catalogue isn't published where we can read it automatically.`;
    case 'shopify_password':
      return `${store} is a Shopify store that isn't open to the public yet (it's password-protected).`;
    case 'woocommerce':
    case 'magento':
    case 'bigcommerce':
    case 'squarespace':
    case 'wix':
    case 'salesforce':
    case 'prestashop':
    case 'shopware':
    case 'webflow':
      return `${store} runs on ${p.name}, which we don't read automatically yet.`;
    case 'wordpress':
      return `${store} runs on WordPress without a shop we can read automatically.`;
    case 'custom':
      return `${store} is a custom-built storefront, so there's no standard catalogue for us to read automatically.`;
    case 'bot_protected':
      return `${store} turns away automated visitors, so we can't read it automatically.`;
    default:
      return `${store} doesn't publish a product catalogue we can read automatically.`;
  }
}

/** The message and ready-to-send email for a store that needs a manual read. */
export function manualRead(store: string, p: Platform): ManualRead {
  const message =
    `${why(store, p)} We can still track it for you: email us at ${CONTACT_EMAIL} and we'll read it by hand, ` +
    `send you the analysis, and keep tracking it every week like your other stores. Just send the email to get started.`;
  const subject = `Please track ${store} for me`;
  const body = [
    'Hi,',
    '',
    `Please start tracking ${store} for me. It couldn't be read automatically.`,
    '',
    `Store: https://${store}`,
    `Platform: ${p.name}`,
    '',
    'Please send me the analysis and keep tracking it every week like my other stores.',
    '',
    'Thanks',
  ].join('\n');
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(CONTACT_EMAIL)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { platform: p.id, platformName: p.name, message, email: { to: CONTACT_EMAIL, subject, body, mailto, gmail } };
}
