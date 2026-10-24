// Reference data for Mo Guard: brands phishers imitate most, with their real domains,
// plus kinds of hosts that phishing pages lean on. Hand-picked; easy to extend.

export const BRANDS = [
  ['PayPal', 'paypal.com'], ['Apple', 'apple.com', 'icloud.com'], ['Microsoft', 'microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com'],
  ['Google', 'google.com', 'gmail.com', 'youtube.com'], ['Amazon', 'amazon.com', 'amazon.co.uk', 'amazon.de'], ['Netflix', 'netflix.com'],
  ['Facebook', 'facebook.com'], ['Instagram', 'instagram.com'], ['WhatsApp', 'whatsapp.com'], ['LinkedIn', 'linkedin.com'],
  ['X', 'x.com', 'twitter.com'], ['TikTok', 'tiktok.com'], ['Snapchat', 'snapchat.com'], ['Discord', 'discord.com'], ['Telegram', 'telegram.org'],
  ['Steam', 'steampowered.com', 'steamcommunity.com'], ['Roblox', 'roblox.com'], ['Spotify', 'spotify.com'], ['Dropbox', 'dropbox.com'],
  ['DocuSign', 'docusign.com', 'docusign.net'], ['Adobe', 'adobe.com'], ['GitHub', 'github.com'], ['Zoom', 'zoom.us'], ['Slack', 'slack.com'],
  ['eBay', 'ebay.com', 'ebay.co.uk'], ['Etsy', 'etsy.com'], ['Shopify', 'shopify.com'], ['Booking.com', 'booking.com'], ['Airbnb', 'airbnb.com'],
  ['DHL', 'dhl.com'], ['FedEx', 'fedex.com'], ['UPS', 'ups.com'], ['USPS', 'usps.com'], ['Royal Mail', 'royalmail.com'], ['Evri', 'evri.com'],
  ['Coinbase', 'coinbase.com'], ['Binance', 'binance.com'], ['Kraken', 'kraken.com'], ['MetaMask', 'metamask.io'], ['Ledger', 'ledger.com'], ['Trust Wallet', 'trustwallet.com'],
  ['Chase', 'chase.com'], ['Bank of America', 'bankofamerica.com'], ['Wells Fargo', 'wellsfargo.com'], ['Citi', 'citi.com'], ['Capital One', 'capitalone.com'],
  ['American Express', 'americanexpress.com'], ['Visa', 'visa.com'], ['Mastercard', 'mastercard.com'], ['HSBC', 'hsbc.co.uk', 'hsbc.com'],
  ['Barclays', 'barclays.co.uk'], ['Lloyds', 'lloydsbank.com'], ['NatWest', 'natwest.com'], ['Santander', 'santander.co.uk'], ['Halifax', 'halifax.co.uk'],
  ['Monzo', 'monzo.com'], ['Revolut', 'revolut.com'], ['Wise', 'wise.com'], ['Stripe', 'stripe.com'], ['Venmo', 'venmo.com'], ['Cash App', 'cash.app'],
  ['HMRC', 'gov.uk'], ['GOV.UK', 'gov.uk'], ['IRS', 'irs.gov'], ['AT&T', 'att.com'], ['Verizon', 'verizon.com'], ['BT', 'bt.com'], ['Vodafone', 'vodafone.co.uk'],
  ['Yahoo', 'yahoo.com'], ['AOL', 'aol.com'], ['Webmail', 'roundcube.net'], ['Wikipedia', 'wikipedia.org'], ['BBC', 'bbc.co.uk'],
].map(([name, ...domains]) => ({ name, domains, key: name.toLowerCase().replace(/[^a-z0-9]/g, '') }));

// Words too short or common to treat as a brand inside another domain ("x", "bt", "citi"…).
export const WEAK_BRAND_KEYS = new Set(['x', 'bt', 'ups', 'citi', 'visa', 'zoom', 'wise', 'steam', 'ledger', 'apple', 'chase', 'kraken', 'evri', 'aol', 'irs', 'bbc', 'webmail', 'govuk', 'hmrc', 'stripe', 'slack']);

// Email and social link redirectors: their link text naturally shows the final address.
export const REDIRECTORS = new Set(['mailchimp.com', 'list-manage.com', 'mcusercontent.com', 'sendgrid.net', 'mandrillapp.com', 'hubspotlinks.com',
  'hs-sites.com', 'mailgun.org', 'sparkpostmail.com', 'constantcontact.com', 'klaviyomail.com', 'lnkd.in', 'outlook.com', 'urldefense.com', 'mimecast.com']);

export const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 't.ly', 'tiny.cc', 's.id']);

// Free website builders and hosting, where anyone can put up a page in minutes.
export const FREE_HOSTS = ['webflow.io', 'vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'firebaseapp.com', 'web.app', 'weebly.com', 'wixsite.com',
  'glitch.me', '000webhostapp.com', 'blogspot.com', 'sites.google.com', 'framer.website', 'framer.app', 'godaddysites.com', 'square.site', 'carrd.co',
  'replit.app', 'onrender.com', 'herokuapp.com', 'r2.dev', 'workers.dev', 'ipfs.io', 'backname.io', 'mybluehost.me', 'azurewebsites.net', 'cloudfront.net'];

export const RISKY_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'link', 'live', 'shop', 'online', 'site', 'icu', 'cyou', 'buzz', 'rest', 'monster',
  'gq', 'cf', 'tk', 'ml', 'ga', 'support', 'help', 'win', 'bid', 'loan', 'work', 'country', 'kim', 'cam', 'quest', 'sbs', 'cfd']);

// Two-part endings, so "barclays.co.uk" is the domain, not "co.uk".
export const MULTI_SUFFIXES = new Set(['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'co.za',
  'com.ng', 'co.in', 'com.mx', 'com.tr', 'com.cn', 'com.sg', 'co.kr', 'com.ar']);

export const LOGIN_WORDS = /(log-?in|sign-?in|verify|verification|secure|account|update|unlock|suspend|wallet|recover|password|billing|invoice|confirm|support|auth)/i;
