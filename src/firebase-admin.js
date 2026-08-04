/**
 * Firebase Admin SDK Configuration
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Server-side Firebase operations with full admin privileges
 * Used by: Express API routes, Voice Call system, Background jobs
 */

const admin = require('firebase-admin');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SINGLETON INITIALIZATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function initializeFirebaseAdmin() {
  // Return existing app if already initialized
  if (admin.apps.length > 0) {
    return admin.app();
  }

  // Option 1: Use service account JSON file (recommended for production)
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccountPath) {
    try {
      const serviceAccount = require(path.resolve(serviceAccountPath));
      const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
        storageBucket: `${serviceAccount.project_id}.appspot.com`,
      });
      console.log('🔥 Firebase Admin initialized with service account file');
      return app;
    } catch (error) {
      console.warn('⚠️ Failed to load service account file:', error.message);
    }
  }

  // Option 2: Use environment variables
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    const app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
      storageBucket: `${projectId}.appspot.com`,
    });
    console.log('🔥 Firebase Admin initialized with environment variables');
    return app;
  }

  // Option 3: Use default credentials (for Google Cloud environments)
  try {
    // Use project ID from NEXT_PUBLIC env if available
    const fallbackProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID || 'noed-4008d';
    const app = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: fallbackProjectId,
    });
    console.log(`🔥 Firebase Admin initialized with default credentials (project: ${fallbackProjectId})`);
    return app;
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed!');
    console.error('   Please configure one of the following:');
    console.error('   1. GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)');
    console.error('   2. FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY');
    console.error('   3. Run in a Google Cloud environment with default credentials');
    throw new Error('Firebase Admin credentials not configured');
  }
}

// Initialize on module load
const app = initializeFirebaseAdmin();

// Export Firebase Admin services
const db = admin.firestore();
const auth = admin.auth();
const storage = admin.storage();
const messaging = admin.messaging();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPER FUNCTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Verify Firebase ID token from client
 * @param {string} idToken - Firebase ID token
 * @returns {Promise<admin.auth.DecodedIdToken>}
 */
async function verifyIdToken(idToken) {
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Token verification failed:', error.message);
    throw new Error('Invalid or expired token');
  }
}

/**
 * Get user role from Firestore
 * @param {string} uid - User ID
 * @returns {Promise<string>} - User role
 */
async function getUserRole(uid) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      return userDoc.data().role || 'customer';
    }
    return 'customer';
  } catch (error) {
    console.error('Failed to get user role:', error.message);
    return 'customer';
  }
}

/**
 * Check if user is admin
 * @param {string} uid - User ID
 * @returns {Promise<boolean>}
 */
async function isAdmin(uid) {
  const role = await getUserRole(uid);
  return role === 'admin';
}

/**
 * Send push notification via FCM
 * @param {string} token - FCM token
 * @param {object} notification - Notification payload
 * @param {object} data - Data payload
 */
async function sendPushNotification(token, notification, data = {}) {
  try {
    const message = {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      webpush: {
        notification: {
          icon: '/icons/icon-192x192.png',
          badge: '/icons/badge-72x72.png',
        },
        fcmOptions: {
          link: data.link || '/',
        },
      },
    };
    
    const response = await messaging.send(message);
    console.log('📱 Push notification sent:', response);
    return response;
  } catch (error) {
    console.error('Push notification failed:', error.message);
    throw error;
  }
}

/**
 * Send notification to multiple users
 * @param {string[]} tokens - Array of FCM tokens
 * @param {object} notification - Notification payload
 * @param {object} data - Data payload
 */
async function sendMulticastNotification(tokens, notification, data = {}) {
  if (!tokens || tokens.length === 0) return;
  
  try {
    const message = {
      tokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
    };
    
    const response = await messaging.sendEachForMulticast(message);
    console.log(`📱 Multicast sent: ${response.successCount} success, ${response.failureCount} failed`);
    return response;
  } catch (error) {
    console.error('Multicast notification failed:', error.message);
    throw error;
  }
}

/**
 * Create user in Firestore (after Firebase Auth signup)
 * @param {object} userData - User data
 */
async function createUserInFirestore(userData) {
  const { uid, displayName, email, phone, role = 'customer', city = 'Thanjavur' } = userData;
  
  const user = {
    uid,
    displayName: displayName || '',
    email: email || '',
    phone: phone || '',
    role,
    language: 'en',
    walletBalance: 0,
    loyaltyPoints: 0,
    referralCode: generateReferralCode(),
    favoriteShopIds: [],
    city,
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  
  await db.collection('users').doc(uid).set(user, { merge: true });
  return user;
}

/**
 * Generate unique referral code
 */
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'NOE';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module.exports = {
  admin,
  app,
  db,
  auth,
  storage,
  messaging,
  verifyIdToken,
  getUserRole,
  isAdmin,
  sendPushNotification,
  sendMulticastNotification,
  createUserInFirestore,
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp,
};
