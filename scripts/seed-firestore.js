#!/usr/bin/env node
/**
 * 🌱 Firestore Seed Script for Namma Ooru Express
 * 
 * This script seeds the production Firestore database with:
 * - Categories
 * - Cities & Zones
 * - Demo Shops (Thanjavur & Kumbakonam)
 * - Products
 * - Coupons
 * - Banners
 * - Admin user
 * 
 * Usage:
 *   npm run seed
 *   # or
 *   node scripts/seed-firestore.js
 * 
 * Requirements:
 *   - Firebase Admin SDK credentials in .env.local or environment
 *   - Firebase project with Firestore enabled
 */

const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIREBASE ADMIN INITIALIZATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function initializeFirebaseAdmin() {
  // Check if already initialized
  if (admin.apps.length > 0) {
    return admin.app();
  }

  // Option 1: Use service account JSON file
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccountPath) {
    const serviceAccount = require(path.resolve(serviceAccountPath));
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  // Option 2: Use environment variables
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  }

  console.error('❌ Firebase Admin credentials not found!');
  console.error('   Please set FIREBASE_ADMIN_* environment variables or');
  console.error('   set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.');
  process.exit(1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEED DATA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SEED_CITIES = [
  { id: 'thanjavur', name: 'Thanjavur', nameTamil: 'தஞ்சாவூர்', state: 'Tamil Nadu', isActive: true, baseDeliveryCharge: 30, perKmCharge: 10, peakHourSurcharge: 15, rainSurcharge: 20 },
  { id: 'kumbakonam', name: 'Kumbakonam', nameTamil: 'கும்பகோணம்', state: 'Tamil Nadu', isActive: true, baseDeliveryCharge: 25, perKmCharge: 8, peakHourSurcharge: 10, rainSurcharge: 15 },
];

const SEED_ZONES = [
  { id: 'tnj-central', name: 'Thanjavur Central', cityId: 'thanjavur', isActive: true, surgeMultiplier: 1.0 },
  { id: 'tnj-south', name: 'Thanjavur South', cityId: 'thanjavur', isActive: true, surgeMultiplier: 1.0 },
  { id: 'tnj-north', name: 'Thanjavur North', cityId: 'thanjavur', isActive: true, surgeMultiplier: 1.0 },
  { id: 'kbk-central', name: 'Kumbakonam Central', cityId: 'kumbakonam', isActive: true, surgeMultiplier: 1.0 },
  { id: 'kbk-east', name: 'Kumbakonam East', cityId: 'kumbakonam', isActive: true, surgeMultiplier: 1.0 },
];

const SEED_CATEGORIES = [
  { id: 'groceries', name: 'Groceries', nameTamil: 'மளிகை', icon: '🛒', image: '', sortOrder: 1, isActive: true },
  { id: 'vegetables', name: 'Vegetables & Fruits', nameTamil: 'காய்கறி & பழங்கள்', icon: '🥬', image: '', sortOrder: 2, isActive: true },
  { id: 'meat', name: 'Meat/Chicken/Fish', nameTamil: 'இறைச்சி/கோழி/மீன்', icon: '🍗', image: '', sortOrder: 3, isActive: true },
  { id: 'medicines', name: 'Medicines', nameTamil: 'மருந்துகள்', icon: '💊', image: '', sortOrder: 4, isActive: true },
  { id: 'bakery', name: 'Bakery', nameTamil: 'பேக்கரி', icon: '🎂', image: '', sortOrder: 5, isActive: true },
  { id: 'restaurants', name: 'Restaurants', nameTamil: 'உணவகங்கள்', icon: '🍽️', image: '', sortOrder: 6, isActive: true },
  { id: 'tea-shops', name: 'Tea Shops/Snacks', nameTamil: 'டீ கடை/சிற்றுண்டி', icon: '☕', image: '', sortOrder: 7, isActive: true },
  { id: 'stationery', name: 'Stationery', nameTamil: 'ஸ்டேஷனரி', icon: '✏️', image: '', sortOrder: 8, isActive: true },
  { id: 'pet-shop', name: 'Pet Shop', nameTamil: 'செல்லப்பிராணி கடை', icon: '🐾', image: '', sortOrder: 9, isActive: true },
  { id: 'flower-shop', name: 'Flower Shop', nameTamil: 'பூ கடை', icon: '🌸', image: '', sortOrder: 10, isActive: true },
  { id: 'electronics', name: 'Electronics', nameTamil: 'எலக்ட்ரானிக்ஸ்', icon: '📱', image: '', sortOrder: 11, isActive: true },
  { id: 'courier', name: 'Courier/Documents', nameTamil: 'கூரியர்/ஆவணங்கள்', icon: '📦', image: '', sortOrder: 12, isActive: true },
  { id: 'water-can', name: 'Water Can', nameTamil: 'தண்ணீர் கேன்', icon: '💧', image: '', sortOrder: 13, isActive: true },
  { id: 'gas-cylinder', name: 'Gas Cylinder', nameTamil: 'காஸ் சிலிண்டர்', icon: '🔥', image: '', sortOrder: 14, isActive: true },
  { id: 'milk', name: 'Milk', nameTamil: 'பால்', icon: '🥛', image: '', sortOrder: 15, isActive: true },
  { id: 'cakes', name: 'Cakes', nameTamil: 'கேக்', icon: '🍰', image: '', sortOrder: 16, isActive: true },
  { id: 'custom-parcel', name: 'Custom Parcel', nameTamil: 'கஸ்டம் பார்சல்', icon: '📫', image: '', sortOrder: 17, isActive: true },
];

const SEED_SHOPS = [
  {
    id: 'shop-1',
    ownerId: 'admin-user',
    name: 'Sri Lakshmi Stores',
    nameTamil: 'ஸ்ரீ லட்சுமி ஸ்டோர்ஸ்',
    description: 'Your daily essentials — fresh groceries, pulses, oils, and more.',
    categoryId: 'groceries',
    tags: ['groceries', 'daily-needs', 'rice', 'oils'],
    phone: '9566700534',
    email: 'store1@nammaooru.express',
    address: { full: '12, East Main Road, Thanjavur', lat: 10.7870, lng: 79.1378, pincode: '613001', city: 'Thanjavur', zoneId: 'tnj-central' },
    images: { logo: '', banner: '', gallery: [] },
    timing: { openTime: '07:00', closeTime: '22:00', days: [0, 1, 2, 3, 4, 5, 6] },
    isOpen: true,
    isHolidayMode: false,
    minOrderAmount: 100,
    deliveryRadius: 5,
    avgPrepTime: 15,
    rating: 4.6,
    totalRatings: 234,
    totalOrders: 1580,
    commission: 8,
    kycStatus: 'approved',
    kycDocs: {},
    isApproved: true,
    isFeatured: true,
  },
  {
    id: 'shop-2',
    ownerId: 'admin-user',
    name: 'Fresh Veggies Market',
    nameTamil: 'ஃப்ரெஷ் காய்கறி மார்க்கெட்',
    description: 'Farm-fresh vegetables and fruits delivered to your doorstep.',
    categoryId: 'vegetables',
    tags: ['vegetables', 'fruits', 'organic', 'fresh'],
    phone: '9876543210',
    email: 'veggies@nammaooru.express',
    address: { full: '45, South Street, Thanjavur', lat: 10.7850, lng: 79.1365, pincode: '613001', city: 'Thanjavur', zoneId: 'tnj-central' },
    images: { logo: '', banner: '', gallery: [] },
    timing: { openTime: '06:00', closeTime: '20:00', days: [0, 1, 2, 3, 4, 5, 6] },
    isOpen: true,
    isHolidayMode: false,
    minOrderAmount: 50,
    deliveryRadius: 4,
    avgPrepTime: 10,
    rating: 4.4,
    totalRatings: 156,
    totalOrders: 890,
    commission: 10,
    kycStatus: 'approved',
    kycDocs: {},
    isApproved: true,
    isFeatured: false,
  },
  {
    id: 'shop-3',
    ownerId: 'admin-user',
    name: 'Annapoorna Restaurant',
    nameTamil: 'அன்னபூர்ணா உணவகம்',
    description: 'Traditional South Indian meals, tiffin, and snacks.',
    categoryId: 'restaurants',
    tags: ['restaurant', 'south-indian', 'meals', 'tiffin'],
    phone: '9988776655',
    email: 'annapoorna@nammaooru.express',
    address: { full: '78, Big Street, Kumbakonam', lat: 10.9617, lng: 79.3881, pincode: '612001', city: 'Kumbakonam', zoneId: 'kbk-central' },
    images: { logo: '', banner: '', gallery: [] },
    timing: { openTime: '06:30', closeTime: '22:30', days: [0, 1, 2, 3, 4, 5, 6] },
    isOpen: true,
    isHolidayMode: false,
    minOrderAmount: 80,
    deliveryRadius: 6,
    avgPrepTime: 25,
    rating: 4.7,
    totalRatings: 512,
    totalOrders: 3200,
    commission: 12,
    kycStatus: 'approved',
    kycDocs: {},
    isApproved: true,
    isFeatured: true,
  },
  {
    id: 'shop-4',
    ownerId: 'admin-user',
    name: 'MedPlus Pharmacy',
    nameTamil: 'மெட்பிளஸ் மருந்தகம்',
    description: 'All medicines, health products, and personal care items.',
    categoryId: 'medicines',
    tags: ['pharmacy', 'medicines', 'health', 'wellness'],
    phone: '9112233445',
    email: 'medplus@nammaooru.express',
    address: { full: '23, Hospital Road, Thanjavur', lat: 10.7900, lng: 79.1400, pincode: '613001', city: 'Thanjavur', zoneId: 'tnj-central' },
    images: { logo: '', banner: '', gallery: [] },
    timing: { openTime: '08:00', closeTime: '23:00', days: [0, 1, 2, 3, 4, 5, 6] },
    isOpen: true,
    isHolidayMode: false,
    minOrderAmount: 0,
    deliveryRadius: 7,
    avgPrepTime: 10,
    rating: 4.5,
    totalRatings: 89,
    totalOrders: 620,
    commission: 5,
    kycStatus: 'approved',
    kycDocs: {},
    isApproved: true,
    isFeatured: false,
  },
  {
    id: 'shop-5',
    ownerId: 'admin-user',
    name: 'Royal Bakery',
    nameTamil: 'ராயல் பேக்கரி',
    description: 'Fresh cakes, pastries, cookies, and birthday special cakes.',
    categoryId: 'bakery',
    tags: ['bakery', 'cakes', 'birthday', 'pastries'],
    phone: '9445566778',
    email: 'royalbakery@nammaooru.express',
    address: { full: '56, Gandhi Road, Kumbakonam', lat: 10.9630, lng: 79.3900, pincode: '612001', city: 'Kumbakonam', zoneId: 'kbk-central' },
    images: { logo: '', banner: '', gallery: [] },
    timing: { openTime: '09:00', closeTime: '21:00', days: [1, 2, 3, 4, 5, 6] },
    isOpen: true,
    isHolidayMode: false,
    minOrderAmount: 150,
    deliveryRadius: 5,
    avgPrepTime: 20,
    rating: 4.8,
    totalRatings: 345,
    totalOrders: 2100,
    commission: 10,
    kycStatus: 'approved',
    kycDocs: {},
    isApproved: true,
    isFeatured: true,
  },
  {
    id: 'shop-6',
    ownerId: 'admin-user',
    name: 'Kumbakonam Degree Coffee',
    nameTamil: 'கும்பகோணம் டிகிரி காபி',
    description: 'Authentic filter coffee, tea, snacks and tiffin items.',
    categoryId: 'tea-shops',
    tags: ['coffee', 'tea', 'snacks', 'filter-coffee'],
    phone: '9667788990',
    email: 'degreecoffee@nammaooru.express',
    address: { full: '34, Temple Street, Kumbakonam', lat: 10.9610, lng: 79.3870, pincode: '612001', city: 'Kumbakonam', zoneId: 'kbk-central' },
    images: { logo: '', banner: '', gallery: [] },
    timing: { openTime: '05:30', closeTime: '21:00', days: [0, 1, 2, 3, 4, 5, 6] },
    isOpen: true,
    isHolidayMode: false,
    minOrderAmount: 30,
    deliveryRadius: 3,
    avgPrepTime: 10,
    rating: 4.9,
    totalRatings: 678,
    totalOrders: 5400,
    commission: 8,
    kycStatus: 'approved',
    kycDocs: {},
    isApproved: true,
    isFeatured: true,
  },
];

const SEED_PRODUCTS = [
  // Sri Lakshmi Stores products
  { id: 'p1', shopId: 'shop-1', categoryId: 'groceries', name: 'Ponni Boiled Rice 5kg', nameTamil: 'பொன்னி புழுங்கல் அரிசி', description: 'Premium quality Ponni rice', images: [], price: 380, discountPrice: 349, unit: '5 kg', isVeg: true, isAvailable: true, stockQuantity: 50, rating: 4.5, totalRatings: 45, sortOrder: 1, tags: ['rice', 'staple'] },
  { id: 'p2', shopId: 'shop-1', categoryId: 'groceries', name: 'Toor Dal 1kg', nameTamil: 'துவரம் பருப்பு', description: 'Yellow split pigeon peas', images: [], price: 180, discountPrice: 159, unit: '1 kg', isVeg: true, isAvailable: true, stockQuantity: 30, rating: 4.3, totalRatings: 32, sortOrder: 2, tags: ['dal', 'pulses'] },
  { id: 'p3', shopId: 'shop-1', categoryId: 'groceries', name: 'Gingelly Oil 1L', nameTamil: 'நல்லெண்ணெய்', description: 'Pure cold-pressed sesame oil', images: [], price: 320, discountPrice: null, unit: '1 L', isVeg: true, isAvailable: true, stockQuantity: 25, rating: 4.7, totalRatings: 28, sortOrder: 3, tags: ['oil', 'cooking'] },
  { id: 'p4', shopId: 'shop-1', categoryId: 'groceries', name: 'Sugar 1kg', nameTamil: 'சர்க்கரை', description: 'White granulated sugar', images: [], price: 55, discountPrice: 49, unit: '1 kg', isVeg: true, isAvailable: true, stockQuantity: 100, rating: 4.2, totalRatings: 55, sortOrder: 4, tags: ['sugar', 'sweetener'] },
  { id: 'p5', shopId: 'shop-1', categoryId: 'groceries', name: 'Tea Powder 500g (3 Roses)', nameTamil: '3 ரோசஸ் டீ தூள்', description: 'Premium blend tea powder', images: [], price: 220, discountPrice: 199, unit: '500 g', isVeg: true, isAvailable: true, stockQuantity: 40, rating: 4.6, totalRatings: 40, sortOrder: 5, tags: ['tea', 'beverage'] },
  { id: 'p6', shopId: 'shop-1', categoryId: 'groceries', name: 'Coconut Oil 500ml', nameTamil: 'தேங்காய் எண்ணெய்', description: 'Pure coconut oil for cooking', images: [], price: 135, discountPrice: null, unit: '500 ml', isVeg: true, isAvailable: true, stockQuantity: 35, rating: 4.4, totalRatings: 22, sortOrder: 6, tags: ['oil', 'coconut'] },
  { id: 'p7', shopId: 'shop-1', categoryId: 'groceries', name: 'Wheat Atta 5kg', nameTamil: 'கோதுமை மாவு', description: 'Whole wheat flour', images: [], price: 260, discountPrice: 239, unit: '5 kg', isVeg: true, isAvailable: true, stockQuantity: 20, rating: 4.3, totalRatings: 18, sortOrder: 7, tags: ['wheat', 'flour'] },
  { id: 'p8', shopId: 'shop-1', categoryId: 'groceries', name: 'Urad Dal 1kg', nameTamil: 'உளுந்து', description: 'Split black gram', images: [], price: 165, discountPrice: null, unit: '1 kg', isVeg: true, isAvailable: true, stockQuantity: 28, rating: 4.4, totalRatings: 15, sortOrder: 8, tags: ['dal', 'pulses'] },

  // Fresh Veggies Market products
  { id: 'p9', shopId: 'shop-2', categoryId: 'vegetables', name: 'Tomato 500g', nameTamil: 'தக்காளி', description: 'Fresh red tomatoes', images: [], price: 25, discountPrice: null, unit: '500 g', isVeg: true, isAvailable: true, stockQuantity: 80, rating: 4.3, totalRatings: 60, sortOrder: 1, tags: ['tomato', 'fresh'] },
  { id: 'p10', shopId: 'shop-2', categoryId: 'vegetables', name: 'Onion 1kg', nameTamil: 'வெங்காயம்', description: 'Fresh onions', images: [], price: 40, discountPrice: 35, unit: '1 kg', isVeg: true, isAvailable: true, stockQuantity: 100, rating: 4.5, totalRatings: 75, sortOrder: 2, tags: ['onion', 'fresh'] },
  { id: 'p11', shopId: 'shop-2', categoryId: 'vegetables', name: 'Potato 1kg', nameTamil: 'உருளைக்கிழங்கு', description: 'Fresh potatoes', images: [], price: 35, discountPrice: null, unit: '1 kg', isVeg: true, isAvailable: true, stockQuantity: 60, rating: 4.4, totalRatings: 50, sortOrder: 3, tags: ['potato', 'fresh'] },
  { id: 'p12', shopId: 'shop-2', categoryId: 'vegetables', name: 'Banana 1 dozen', nameTamil: 'வாழைப்பழம்', description: 'Ripe yellow bananas', images: [], price: 50, discountPrice: 45, unit: '12 pcs', isVeg: true, isAvailable: true, stockQuantity: 40, rating: 4.6, totalRatings: 35, sortOrder: 4, tags: ['banana', 'fruit'] },
  { id: 'p13', shopId: 'shop-2', categoryId: 'vegetables', name: 'Drumstick 250g', nameTamil: 'முருங்கைக்காய்', description: 'Fresh drumsticks', images: [], price: 30, discountPrice: null, unit: '250 g', isVeg: true, isAvailable: true, stockQuantity: 30, rating: 4.2, totalRatings: 20, sortOrder: 5, tags: ['drumstick', 'fresh'] },

  // Annapoorna Restaurant products
  { id: 'p14', shopId: 'shop-3', categoryId: 'restaurants', name: 'Meals (Unlimited)', nameTamil: 'மீல்ஸ் (அன்லிமிடெட்)', description: 'Traditional South Indian thali', images: [], price: 120, discountPrice: null, unit: '1 plate', isVeg: true, isAvailable: true, stockQuantity: 999, rating: 4.8, totalRatings: 200, sortOrder: 1, tags: ['meals', 'thali'] },
  { id: 'p15', shopId: 'shop-3', categoryId: 'restaurants', name: 'Chicken Biryani', nameTamil: 'சிக்கன் பிரியாணி', description: 'Aromatic chicken biryani', images: [], price: 180, discountPrice: 160, unit: '1 plate', isVeg: false, isAvailable: true, stockQuantity: 999, rating: 4.7, totalRatings: 180, sortOrder: 2, tags: ['biryani', 'non-veg'] },
  { id: 'p16', shopId: 'shop-3', categoryId: 'restaurants', name: 'Masala Dosa', nameTamil: 'மசாலா தோசை', description: 'Crispy dosa with potato filling', images: [], price: 60, discountPrice: null, unit: '1 pc', isVeg: true, isAvailable: true, stockQuantity: 999, rating: 4.5, totalRatings: 150, sortOrder: 3, tags: ['dosa', 'tiffin'] },
  { id: 'p17', shopId: 'shop-3', categoryId: 'restaurants', name: 'Idli (3 pcs)', nameTamil: 'இட்லி', description: 'Soft steamed rice cakes', images: [], price: 40, discountPrice: null, unit: '3 pcs', isVeg: true, isAvailable: true, stockQuantity: 999, rating: 4.6, totalRatings: 120, sortOrder: 4, tags: ['idli', 'tiffin'] },
  { id: 'p18', shopId: 'shop-3', categoryId: 'restaurants', name: 'Parotta + Salna', nameTamil: 'பரோட்டா + சால்னா', description: 'Layered flatbread with curry', images: [], price: 70, discountPrice: null, unit: '2 pcs', isVeg: true, isAvailable: true, stockQuantity: 999, rating: 4.4, totalRatings: 90, sortOrder: 5, tags: ['parotta', 'dinner'] },

  // Royal Bakery products
  { id: 'p19', shopId: 'shop-5', categoryId: 'bakery', name: 'Chocolate Cake 500g', nameTamil: 'சாக்லேட் கேக்', description: 'Rich chocolate cake', images: [], price: 350, discountPrice: 320, unit: '500 g', isVeg: true, isAvailable: true, stockQuantity: 10, rating: 4.8, totalRatings: 85, sortOrder: 1, tags: ['cake', 'chocolate'] },
  { id: 'p20', shopId: 'shop-5', categoryId: 'bakery', name: 'Puff (Egg)', nameTamil: 'பஃப் (முட்டை)', description: 'Flaky pastry with egg filling', images: [], price: 25, discountPrice: null, unit: '1 pc', isVeg: false, isAvailable: true, stockQuantity: 50, rating: 4.3, totalRatings: 60, sortOrder: 2, tags: ['puff', 'snack'] },
  { id: 'p21', shopId: 'shop-5', categoryId: 'bakery', name: 'Birthday Cake 1kg', nameTamil: 'பிறந்தநாள் கேக்', description: 'Custom birthday cake', images: [], price: 650, discountPrice: 599, unit: '1 kg', isVeg: true, isAvailable: true, stockQuantity: 5, rating: 4.9, totalRatings: 45, sortOrder: 3, tags: ['cake', 'birthday'] },

  // Kumbakonam Degree Coffee
  { id: 'p22', shopId: 'shop-6', categoryId: 'tea-shops', name: 'Filter Coffee', nameTamil: 'ஃபில்டர் காபி', description: 'Authentic Kumbakonam filter coffee', images: [], price: 20, discountPrice: null, unit: '1 cup', isVeg: true, isAvailable: true, stockQuantity: 999, rating: 4.9, totalRatings: 300, sortOrder: 1, tags: ['coffee', 'filter'] },
  { id: 'p23', shopId: 'shop-6', categoryId: 'tea-shops', name: 'Masala Tea', nameTamil: 'மசாலா டீ', description: 'Spiced masala chai', images: [], price: 15, discountPrice: null, unit: '1 cup', isVeg: true, isAvailable: true, stockQuantity: 999, rating: 4.7, totalRatings: 200, sortOrder: 2, tags: ['tea', 'masala'] },
  { id: 'p24', shopId: 'shop-6', categoryId: 'tea-shops', name: 'Bajji (5 pcs)', nameTamil: 'பஜ்ஜி', description: 'Crispy fried fritters', images: [], price: 30, discountPrice: null, unit: '5 pcs', isVeg: true, isAvailable: true, stockQuantity: 999, rating: 4.5, totalRatings: 150, sortOrder: 3, tags: ['bajji', 'snack'] },
  { id: 'p25', shopId: 'shop-6', categoryId: 'tea-shops', name: 'Bonda (4 pcs)', nameTamil: 'போண்டா', description: 'Soft potato dumplings', images: [], price: 25, discountPrice: null, unit: '4 pcs', isVeg: true, isAvailable: true, stockQuantity: 999, rating: 4.6, totalRatings: 130, sortOrder: 4, tags: ['bonda', 'snack'] },
];

const SEED_COUPONS = [
  { id: 'c1', code: 'FIRST50', description: '50% off on your first order', type: 'percentage', value: 50, minOrderAmount: 100, maxDiscount: 100, usageLimit: 1, usedCount: 0, applicableShopIds: [], isActive: true, validFrom: new Date(), validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  { id: 'c2', code: 'NOE30', description: '₹30 off on orders above ₹200', type: 'flat', value: 30, minOrderAmount: 200, maxDiscount: 30, usageLimit: 5, usedCount: 0, applicableShopIds: [], isActive: true, validFrom: new Date(), validTo: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
  { id: 'c3', code: 'FREEDEL', description: 'Free delivery on orders above ₹500', type: 'flat', value: 50, minOrderAmount: 500, maxDiscount: 50, usageLimit: 10, usedCount: 0, applicableShopIds: [], isActive: true, validFrom: new Date(), validTo: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) },
  { id: 'c4', code: 'WELCOME100', description: '₹100 off for new users', type: 'flat', value: 100, minOrderAmount: 300, maxDiscount: 100, usageLimit: 1, usedCount: 0, applicableShopIds: [], isActive: true, validFrom: new Date(), validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
];

const SEED_BANNERS = [
  { id: 'b1', title: 'First Order 50% OFF', image: '', link: '/offers', position: 1, isActive: true, validFrom: new Date(), validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  { id: 'b2', title: 'Free Delivery on ₹500+', image: '', link: '/offers', position: 2, isActive: true, validFrom: new Date(), validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  { id: 'b3', title: 'Refer & Earn ₹100', image: '', link: '/profile', position: 3, isActive: true, validFrom: new Date(), validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEED FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function seedCollection(db, collectionName, data, idField = 'id') {
  console.log(`\n📦 Seeding ${collectionName}...`);
  const batch = db.batch();
  let count = 0;

  for (const item of data) {
    const docId = item[idField];
    const docRef = db.collection(collectionName).doc(docId);
    const docData = {
      ...item,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    batch.set(docRef, docData, { merge: true });
    count++;
  }

  await batch.commit();
  console.log(`   ✅ Added ${count} documents to ${collectionName}`);
}

async function seedAdminUser(db) {
  console.log('\n👤 Creating admin user...');
  
  const adminUser = {
    uid: 'admin-user',
    displayName: 'NOE Admin',
    email: 'admin@nammaooru.express',
    phone: '+919566700534',
    role: 'admin',
    language: 'en',
    walletBalance: 0,
    loyaltyPoints: 0,
    referralCode: 'NOEADMIN',
    favoriteShopIds: [],
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('users').doc('admin-user').set(adminUser, { merge: true });
  console.log('   ✅ Admin user created');
}

async function main() {
  console.log('🌱 ═══════════════════════════════════════════════════════');
  console.log('   NAMMA OORU EXPRESS - FIRESTORE SEED SCRIPT');
  console.log('   நம்ம ஊரு எக்ஸ்பிரஸ் - தரவு விதைப்பு');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Initialize Firebase Admin
  console.log('🔥 Initializing Firebase Admin SDK...');
  initializeFirebaseAdmin();
  const db = admin.firestore();
  console.log('   ✅ Connected to Firestore\n');

  try {
    // Seed all collections
    await seedCollection(db, 'cities', SEED_CITIES);
    await seedCollection(db, 'zones', SEED_ZONES);
    await seedCollection(db, 'categories', SEED_CATEGORIES);
    await seedCollection(db, 'shops', SEED_SHOPS);
    await seedCollection(db, 'products', SEED_PRODUCTS);
    await seedCollection(db, 'coupons', SEED_COUPONS);
    await seedCollection(db, 'banners', SEED_BANNERS);
    await seedAdminUser(db);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 SEED COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\n📊 Summary:');
    console.log(`   • Cities: ${SEED_CITIES.length}`);
    console.log(`   • Zones: ${SEED_ZONES.length}`);
    console.log(`   • Categories: ${SEED_CATEGORIES.length}`);
    console.log(`   • Shops: ${SEED_SHOPS.length}`);
    console.log(`   • Products: ${SEED_PRODUCTS.length}`);
    console.log(`   • Coupons: ${SEED_COUPONS.length}`);
    console.log(`   • Banners: ${SEED_BANNERS.length}`);
    console.log(`   • Admin User: 1`);
    console.log('\n✅ Your Firestore database is ready for production!\n');

  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the script
main();
