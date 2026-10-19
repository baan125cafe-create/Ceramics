// Everything that differs between the shops lives here. The app code is shared:
// adding a shop means adding one entry, not copying pages.
window.SHOP_CONFIG = {
  shops: {
    baan: {
      name: 'Baan 125',
      sub: 'Hangout · ceramics',
      icon: 'pot',
      // Same browser key the old owner/staff pages use, so a device that already
      // saved this shop's script link connects without setup.
      apiKey: 'baan125_api_url',
      staffDefault: ['PB', 'Lin', 'Milk'],
      lowAtDefault: 2
    },
    chud: {
      name: 'ChudPak',
      sub: 'Clothing',
      icon: 'shirt',
      apiKey: 'chudpak_api_url',
      staffDefault: ['PB', 'Lin', 'Milk'],
      // Clothes are mostly one-offs, so ChudPak only tracks "sold out".
      lowStock: false
    }
  },
  // Payment types offered when recording a sale. Older rows saved as "credit"
  // (card and QR were one button) are shown as "Card or QR (older)".
  payments: [
    { id: 'cash', label: 'Cash' },
    { id: 'card', label: 'Card' },
    { id: 'qr', label: 'QR code' }
  ],
  pinLength: 6
};
