// Sarah's inbox: 100 made-up emails, the same every load. Used by the inbox page, the
// unsubscribe page and the seed script. Every brand and address here is invented.

export const ADA = 'sarah@example.com';

// Senders with an unsubscribe page. Each page has the same choices, so a lesson taught
// on one sender's page is recalled on the next one.
export const SENDERS = {
  dealdash: { name: 'DealDash', from: 'deals@dealdash.example', kind: 'marketing' },
  stylehub: { name: 'StyleHub', from: 'hello@stylehub.example', kind: 'marketing' },
  freshbox: { name: 'Freshbox', from: 'cook@freshbox.example', kind: 'marketing' },
  gadgetgrove: { name: 'GadgetGrove', from: 'offers@gadgetgrove.example', kind: 'marketing' },
  travelnest: { name: 'TravelNest', from: 'trips@travelnest.example', kind: 'marketing' },
  bloomco: { name: 'Bloom & Co', from: 'flowers@bloomco.example', kind: 'marketing' },
  pixelplay: { name: 'PixelPlay', from: 'news@pixelplay.example', kind: 'marketing' },
  homehaven: { name: 'HomeHaven', from: 'home@homehaven.example', kind: 'marketing' },
  runwell: { name: 'Runwell', from: 'team@runwell.example', kind: 'marketing' },
  bookly: { name: 'Bookly', from: 'reads@bookly.example', kind: 'marketing' },
  lagosletter: { name: 'The Lagos Letter', from: 'editor@lagosletter.example', kind: 'newsletter' },
  weeklybyte: { name: 'The Weekly Byte', from: 'byte@weeklybyte.example', kind: 'newsletter' },
  calmly: { name: 'Calmly', from: 'hello@calmly.example', kind: 'subscription' },
  streamly: { name: 'Streamly', from: 'account@streamly.example', kind: 'subscription' },
  irongym: { name: 'Iron Gym', from: 'members@irongym.example', kind: 'subscription' },
};

// The newest emails, the ones the demo uses, in inbox order.
const PINNED = [
  { personal: true, name: 'Grace Okoro (Sales)', from: 'grace.okoro@acme.example', subject: 'New customers, week 45', time: '09:30',
    body: ['Hi Sarah,', 'Here are the customers who signed up last week. Could you add them to the Helpdesk today so support can see them?', 'Thanks, Grace'],
    attachment: { name: 'new-customers-week-45.csv', href: '/demo/files/new-customers-week-45.csv' } },
  { sender: 'dealdash', subject: '48 hours only: up to 70% off everything', time: '09:12',
    body: ['Hi Sarah,', 'Our biggest sale of the year ends Sunday at midnight. Headphones, air fryers, duvets: up to 70% off.', 'Use code DASH70 at checkout.'], cta: 'Shop the sale' },
  { sender: 'calmly', subject: 'Your week in calm: 0 minutes', time: '08:40',
    body: ['Hi Sarah,', 'You meditated for 0 minutes this week, and 0 minutes this month.', 'Your Calmly Premium plan renews on 3 November for £6.99. Manage it any time from your account.'], cta: 'Manage my subscription', href: '/demo/calmly/' },
  { sender: 'stylehub', subject: 'New in: the autumn edit 🍂', time: '08:05',
    body: ['Hi Sarah,', 'Knitwear, boots and the coat everyone is asking about. Free delivery over £40 this week.'], cta: 'See the autumn edit' },
  { phishing: true, name: 'PayPal', from: 'service@paypal-notices.example', subject: 'Unsubscribe from PayPal promotional emails', time: '07:51',
    body: ['Dear customer,', 'We noticed you receive promotional emails. To stop them, confirm your account below within 24 hours or your account may be limited.'],
    cta: 'Unsubscribe and confirm account', href: 'http://paypal-com-unsubscribe.localhost:PORT/demo/guard/login.html?brand=PayPal' },
  { sender: 'irongym', subject: 'Your membership renews on 2 November', time: 'Yesterday',
    body: ['Hi Sarah,', 'Your Iron Gym Plus membership (£39) and Recovery+ add-on (£9) renew on 2 November: £48 in total.', 'We haven\'t seen you for 42 days. Book a class and get back on track!'], cta: 'Manage my membership', href: '/demo/gym/' },
  { sender: 'streamly', subject: 'Your receipt: £10.99', time: 'Yesterday',
    body: ['Hi Sarah,', 'Thanks for your payment of £10.99 for Streamly Standard.', 'Because you watched The Long Coast this week: the final season is out now.'], cta: 'Keep watching' },
  { sender: 'lagosletter', subject: 'Issue 112: the new Lekki bridge, and where to eat this weekend', time: 'Yesterday',
    body: ['Morning Sarah,', 'Thanks for being a paying reader (£4 a month). This week: the new bridge, a jollof showdown, and three gigs worth leaving the house for.'], cta: 'Read the full issue' },
  { sender: 'freshbox', subject: 'We miss you, Sarah! 60% off your next box', time: 'Mon',
    body: ['Hi Sarah,', 'It\'s been a while. Come back to Freshbox and get 60% off your next box, plus free dessert.'], cta: 'Claim 60% off' },
  { personal: true, name: 'Kofi Mensah', from: 'kofi@example.com', subject: 'Saturday?', time: 'Mon',
    body: ['Still on for football on Saturday? 10am at the usual pitch.'] },
  { sender: 'gadgetgrove', subject: 'Your basket is waiting: the Pixel Buds are back in stock', time: 'Mon',
    body: ['Hi Sarah,', 'Good news: the earbuds in your basket are back. Only 12 left.'], cta: 'Go to my basket' },
  { receipt: true, sender: 'stylehub', subject: 'Your order #SH-20931 has shipped', time: 'Sun',
    body: ['Hi Sarah,', 'Your order is on its way and should arrive on Tuesday. Track it from your account.'], cta: 'Track my order' },
  { sender: 'weeklybyte', subject: 'The Weekly Byte: chips, cables and a very fast robot', time: 'Sun',
    body: ['Hi Sarah,', 'Five stories from tech this week, in five minutes.'], cta: 'Read online' },
];

// Older mail: a realistic mix, generated the same way every time.
function rand(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const MARKETING_SUBJECTS = [
  'Last chance: {n}% off ends tonight', 'Just for you, Sarah: our picks this week', 'Free delivery this weekend only',
  'You left something behind', 'New arrivals you\'ll love', 'Flash sale: {n}% off for 6 hours', 'Sarah, your exclusive code is inside',
  'Our bestsellers are back', 'Don\'t miss out: members\' week', 'Treat yourself this Friday', 'We\'ve got a gift for you 🎁',
];
const RECEIPT_SUBJECTS = ['Your order has been delivered', 'Your receipt from {name}', 'Order confirmed: #{code}', 'Your delivery is arriving today'];
const PEOPLE = [['Mum', 'mum@example.com'], ['Priya Shah', 'priya@work.example'], ['Tunde Bello', 'tunde@example.com'], ['Lena Fischer', 'lena@example.com']];
const PERSONAL_SUBJECTS = ['Photos from Sunday', 'Re: dinner plans', 'Meeting notes', 'Can you call me later?', 'Happy birthday!!', 'Quick question'];
const PHISHING = [
  ['Royal Mail', 'noreply@royalmail-redelivery.example', 'We missed your parcel: pay £1.99 to rebook', 'http://royalmail-redelivery.localhost:PORT/demo/guard/login.html?brand=Royal%20Mail'],
  ['Netflix', 'billing@netflix-account.example', 'Your payment failed: update your details', 'http://netflix-billing-update.localhost:PORT/demo/guard/login.html?brand=Netflix'],
];
const DAYS = ['Sat', 'Fri', 'Thu', 'Wed', '20 Oct', '19 Oct', '18 Oct', '17 Oct', '16 Oct', '15 Oct', '14 Oct', '13 Oct', '12 Oct', '11 Oct', '10 Oct', '9 Oct', '8 Oct'];

function older(count) {
  const r = rand(112);
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const marketing = Object.keys(SENDERS).filter(k => SENDERS[k].kind === 'marketing');
  const out = [];
  for (let i = 0; i < count; i++) {
    const time = DAYS[Math.min(DAYS.length - 1, Math.floor(i / 6))];
    const roll = r();
    if (i === 20 || i === 55) {
      const [name, from, subject, href] = PHISHING[i === 20 ? 0 : 1];
      out.push({ phishing: true, name, from, subject, time, body: ['Action needed on your account. Please confirm your details within 24 hours.'], cta: 'Confirm now', href });
    } else if (roll < 0.62) {
      const sender = pick(marketing);
      out.push({ sender, subject: pick(MARKETING_SUBJECTS).replace('{n}', pick([20, 30, 40, 50])), time,
        body: ['Hi Sarah,', `Here's what's new at ${SENDERS[sender].name} this week. Offers end soon.`], cta: 'Shop now' });
    } else if (roll < 0.76) {
      const sender = pick(['stylehub', 'freshbox', 'gadgetgrove', 'bookly', 'homehaven']);
      out.push({ receipt: true, sender, subject: pick(RECEIPT_SUBJECTS).replace('{name}', SENDERS[sender].name).replace('{code}', String(10000 + Math.floor(r() * 89999))), time,
        body: ['Hi Sarah,', 'Thanks for your order. You can see the details in your account.'], cta: 'View my order' });
    } else if (roll < 0.87) {
      const sender = pick(['lagosletter', 'weeklybyte']);
      out.push({ sender, subject: `${SENDERS[sender].name}: issue ${100 + i}`, time, body: ['Hi Sarah,', 'This week\'s stories, in five minutes.'], cta: 'Read the issue' });
    } else {
      const [name, from] = pick(PEOPLE);
      out.push({ personal: true, name, from, subject: pick(PERSONAL_SUBJECTS), time, body: ['Hi Sarah, let me know when you get a chance.'] });
    }
  }
  return out;
}

export const EMAILS = [...PINNED, ...older(100 - PINNED.length)].map((m, i) => {
  const s = m.sender ? SENDERS[m.sender] : null;
  return { id: i + 1, name: m.name || s.name, from: m.from || s.from, ...m,
    unsubscribe: s && !m.personal && !m.phishing && !m.receipt ? `/demo/inbox/unsubscribe.html?s=${m.sender}` : null };
});
