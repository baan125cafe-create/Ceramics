// Everything that differs between the shops lives here. The app code is shared:
// adding a shop means adding one entry, not copying pages.
window.SHOP_CONFIG = {
  // Address of the shop API on Cloudflare (see worker/README.md). Not a secret:
  // every request still needs a PIN sign-in. Leave empty until it's deployed.
  api: '',
  shops: {
    baan: {
      name: 'Baan 125',
      sub: 'Hangout · ceramics',
      icon: 'pot',
      staffDefault: ['PB', 'Lin', 'Milk'],
      lowAtDefault: 2
    },
    chud: {
      name: 'ChudPak',
      sub: 'Clothing',
      icon: 'shirt',
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
