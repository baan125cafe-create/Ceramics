// Everything that differs between the shops lives here. The app code is shared:
// adding a shop means adding one entry, not copying pages.
window.SHOP_CONFIG = {
  // Address of the shop API on Cloudflare (see worker/README.md). Not a secret:
  // every request still needs a PIN sign-in. Leave empty until it's deployed.
  api: 'https://api.milkyanyong.shop',
  // Used automatically if a device can't reach the address above (for example while a
  // phone network hasn't picked up the domain yet).
  apiBackup: 'https://shop-api.milkshops.workers.dev',
  shops: {
    baan: {
      name: 'Baan 125',
      sub: 'Hangout · ceramics',
      icon: 'pot',      // placeholder on product photos
      logo: 'cup',      // shop logo (ceramic mug): menu, sign-in, title
      nameHint: 'Lotus mug', // example text in the Add product form
      sizeHint: '300 ml',
      staffDefault: ['PB', 'Lin', 'Milk'],
      lowAtDefault: 2
    },
    chud: {
      name: 'ChudPak',
      sub: 'Clothing',
      icon: 'shirt',
      logo: 'dress',
      nameHint: 'Linen dress',
      sizeHint: 'M or Free size', // Thai shops use S–XL and "Free size" (one size)
      staffDefault: ['PB', 'Lin', 'Milk'],
      // Clothes are mostly one-offs, so ChudPak only tracks "sold out".
      lowStock: false
    }
  },
  // Starting payment types. The owner can rename, add or retire them in Settings.
  // Each sale keeps the type it was saved with, so editing never changes past sales.
  payments: [
    { id: 'cash', label: 'Cash' },
    { id: 'card', label: 'Card' },
    { id: 'qr', label: 'QR code' }
  ],
  pinLength: 6
};
