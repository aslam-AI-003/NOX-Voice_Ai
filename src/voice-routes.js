// ============================================================
// Namma Ooru Express — AI Voice Call Ordering API Routes
// PRODUCTION VERSION — Real Firestore Integration
// ============================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db, admin, FieldValue, messaging } = require('./firebase-admin');

// In-memory active calls store (in production, use Redis for multi-instance)
const activeCalls = new Map();

// ─── CONFIGURATION ───────────────────────────────────────────

const VOICE_CONFIG = {
  confidenceThreshold: 70,
  maxClarificationAttempts: 2,
  maxCallDuration: 300,
  highValueOrderThreshold: 2000,
  recordingRetentionDays: 90,
  concurrentCallLimit: 10,
};

// Rate limiting per phone number (anti-fraud)
const callRateLimit = new Map(); // phone → { count, lastReset }
const RATE_LIMIT_MAX = 10; // max 10 calls per hour per number
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(phone) {
  const now = Date.now();
  const entry = callRateLimit.get(phone);
  if (!entry || now - entry.lastReset > RATE_LIMIT_WINDOW) {
    callRateLimit.set(phone, { count: 1, lastReset: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── TELEPHONY WEBHOOKS ──────────────────────────────────────

/**
 * POST /api/voice/incoming-call
 * Webhook: Telephony provider sends this when a call comes in
 */
router.post('/incoming-call', async (req, res) => {
  try {
    const { CallSid, From, To, CallStatus, StartTime, Direction } = req.body;

    console.log(`📞 Incoming call: ${CallSid} from ${From}`);

    // Rate limit check
    if (!checkRateLimit(From)) {
      console.warn(`⚠️ Rate limit exceeded for ${From}`);
      return res.status(429).json({
        success: false,
        error: 'Too many calls. Please try again later.',
        action: 'play_message',
        message_ta: 'நன்றி. தயவுசெய்து சிறிது நேரம் கழித்து மீண்டும் call செய்யுங்கள்.',
      });
    }

    // Check concurrent call limit
    if (activeCalls.size >= VOICE_CONFIG.concurrentCallLimit) {
      console.warn(`⚠️ Concurrent call limit reached: ${activeCalls.size}`);
      return res.status(503).json({
        success: false,
        error: 'All lines busy',
        action: 'play_message',
        message_ta: 'நன்றி. எல்லா lines-ம் busy-ஆ இருக்கு. தயவுசெய்து 2 நிமிசம் கழித்து call செய்யுங்கள்.',
      });
    }

    // Create voice call record
    const callRecord = {
      id: `vc_${crypto.randomBytes(8).toString('hex')}`,
      callId: CallSid,
      callerPhone: From,
      startTime: StartTime || new Date().toISOString(),
      outcome: 'in_progress',
      escalatedToHuman: false,
      detectedLanguage: 'ta',
      transcript: [],
      turnIndex: 0,
      partialOrder: null,
      metadata: {
        telephonyProvider: req.headers['x-provider'] || 'exotel',
        direction: Direction || 'inbound',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    activeCalls.set(CallSid, callRecord);

    // Look up customer voice profile
    const voiceProfile = await getCustomerVoiceProfile(From);

    // Emit to admin dashboard via Socket.IO
    if (global.io) {
      global.io.to('role-admin').emit('voice-call-started', {
        callId: callRecord.id,
        phone: From,
        time: callRecord.startTime,
      });
    }

    // Return response to telephony provider (connect to AI agent)
    res.json({
      success: true,
      callId: callRecord.id,
      action: 'connect_to_ai_agent',
      config: {
        systemPrompt: 'VOICE_AGENT_SYSTEM_PROMPT',
        greeting: voiceProfile
          ? `Vanakkam ${voiceProfile.knownName || ''}! Namma Ooru Express. Enna order venum?`
          : 'Vanakkam! Namma Ooru Express-ku varaverkiren. Enna order venum?',
        language: voiceProfile?.preferredLanguage || 'ta',
        tools: ['search_shops', 'search_item', 'get_last_order', 'create_order', 'transfer_to_human', 'send_sms_confirmation'],
        callerProfile: voiceProfile || null,
      },
    });
  } catch (error) {
    console.error('❌ Incoming call error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/voice/call-ended
 * Webhook: Telephony provider sends this when a call ends
 */
router.post('/call-ended', async (req, res) => {
  try {
    const { CallSid, From, CallStatus, Duration, RecordingUrl, EndTime } = req.body;

    console.log(`📞 Call ended: ${CallSid} | Duration: ${Duration}s | Status: ${CallStatus}`);

    const callRecord = activeCalls.get(CallSid);
    if (!callRecord) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    // Update call record
    callRecord.endTime = EndTime || new Date().toISOString();
    callRecord.duration = Duration || 0;
    callRecord.recordingUrl = RecordingUrl || null;
    callRecord.updatedAt = new Date().toISOString();

    // Determine outcome if still in_progress
    if (callRecord.outcome === 'in_progress') {
      if (CallStatus === 'completed' && !callRecord.linkedOrderId) {
        callRecord.outcome = 'no_order';
      } else if (['failed', 'busy', 'no-answer'].includes(CallStatus)) {
        callRecord.outcome = 'call_dropped';
      } else if (Duration && Duration < 10) {
        callRecord.outcome = 'abandoned';
      }
    }

    // Save to Firestore
    await saveVoiceCall(callRecord);

    // Update customer voice profile on successful order
    if (callRecord.outcome === 'order_created') {
      await updateCustomerVoiceProfile(From, callRecord);
    }

    // Emit to admin dashboard
    if (global.io) {
      global.io.to('role-admin').emit('voice-call-ended', {
        callId: callRecord.id,
        outcome: callRecord.outcome,
        duration: callRecord.duration,
      });
    }

    // Remove from active calls
    activeCalls.delete(CallSid);

    res.json({ success: true, callId: callRecord.id, outcome: callRecord.outcome });
  } catch (error) {
    console.error('❌ Call ended error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/voice/transcript-turn
 * Streaming transcript ingestion — each AI/customer turn
 */
router.post('/transcript-turn', async (req, res) => {
  try {
    const { callSid, speaker, text, language, confidence } = req.body;

    const callRecord = activeCalls.get(callSid);
    if (!callRecord) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    const turn = {
      id: `turn_${crypto.randomBytes(4).toString('hex')}`,
      callId: callSid,
      turnIndex: callRecord.turnIndex++,
      speaker,
      text,
      timestamp: new Date().toISOString(),
      detectedLanguage: language || 'ta',
      confidence: confidence || null,
    };

    callRecord.transcript.push(turn);

    // Update detected language if customer speaks
    if (speaker === 'customer' && language) {
      callRecord.detectedLanguage = language;
    }

    // Emit live transcript to admin
    if (global.io) {
      global.io.to('role-admin').emit('voice-transcript-update', {
        callId: callRecord.id,
        turn,
      });
    }

    res.json({ success: true, turnId: turn.id });
  } catch (error) {
    console.error('❌ Transcript turn error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── AI TOOL ENDPOINTS ───────────────────────────────────────

/**
 * POST /api/voice/search-shops
 * Tool: search_shops(area, item_category, item_name)
 */
router.post('/search-shops', async (req, res) => {
  try {
    const { area, item_category, item_name } = req.body;

    console.log(`🔍 Search shops: area=${area}, category=${item_category}, item=${item_name}`);

    const shops = await searchShopsForVoice(area, item_category, item_name);

    res.json({
      success: true,
      results: shops,
      count: shops.length,
    });
  } catch (error) {
    console.error('❌ Search shops error:', error);
    res.status(500).json({ success: false, results: [], error: error.message });
  }
});

/**
 * POST /api/voice/search-item
 * Tool: search_item(shop_id, item_query)
 */
router.post('/search-item', async (req, res) => {
  try {
    const { shop_id, item_query } = req.body;

    console.log(`🔍 Search item: shop=${shop_id}, query=${item_query}`);

    const items = await searchItemInShop(shop_id, item_query);

    res.json({
      success: true,
      results: items,
      count: items.length,
    });
  } catch (error) {
    console.error('❌ Search item error:', error);
    res.status(500).json({ success: false, results: [], error: error.message });
  }
});

/**
 * GET /api/voice/last-order/:phone
 * Tool: get_last_order(caller_phone)
 */
router.get('/last-order/:phone', async (req, res) => {
  try {
    const { phone } = req.params;

    console.log(`📋 Get last order for: ${phone}`);

    const lastOrder = await getLastOrderByPhone(phone);

    if (!lastOrder) {
      return res.json({
        success: false,
        message: 'No previous orders found for this number',
        result: null,
      });
    }

    res.json({
      success: true,
      result: lastOrder,
    });
  } catch (error) {
    console.error('❌ Get last order error:', error);
    res.status(500).json({ success: false, result: null, error: error.message });
  }
});

/**
 * POST /api/voice/create-order
 * Tool: create_order — REUSES existing order creation logic
 */
router.post('/create-order', async (req, res) => {
  try {
    const { shop_id, items, customer_phone, delivery_address, customer_name, call_id } = req.body;

    console.log(`📦 Create voice order: shop=${shop_id}, items=${items.length}, phone=${customer_phone}`);

    // Validate required fields
    if (!shop_id || !items || !items.length || !customer_phone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: shop_id, items, customer_phone',
      });
    }

    // Get shop details
    const shopDoc = await db.collection('shops').doc(shop_id).get();
    const shopData = shopDoc.exists ? shopDoc.data() : {};
    const shopName = shopData.name || shopData.shopName || 'Unknown Shop';

    // Calculate order total
    let subtotal = 0;
    const orderItems = items.map(item => {
      const itemTotal = (item.price || 0) * item.quantity;
      subtotal += itemTotal;
      return {
        productId: item.product_id || `voice_${crypto.randomBytes(4).toString('hex')}`,
        shopId: shop_id,
        name: item.name,
        nameTamil: item.name_tamil || item.name,
        price: item.price || 0,
        quantity: item.quantity,
        unit: item.unit,
        brand: item.brand || '',
        isVeg: true,
      };
    });

    const deliveryCharge = subtotal >= 500 ? 0 : 50;
    const total = subtotal + deliveryCharge;

    // High-value order check
    if (total > VOICE_CONFIG.highValueOrderThreshold) {
      await sendSmsConfirmation(customer_phone, {
        shopId: shop_id,
        shopName,
        items: orderItems,
        total,
        confirmationRequired: true,
      });
      return res.json({
        success: true,
        requiresConfirmation: true,
        message: `Order total is ₹${total}. SMS confirmation link sent to ${customer_phone}`,
      });
    }

    // Create order in Firestore (same structure as app checkout)
    const orderData = {
      userId: `voice_${customer_phone.replace(/\D/g, '')}`,
      shopId: shop_id,
      shopName,
      shopIcon: '📞',
      items: orderItems,
      subtotal,
      deliveryCharge,
      discount: 0,
      total,
      status: 'placed', // Shows up in vendor's "New Orders" tab immediately
      paymentMethod: 'cash_on_delivery',
      address: {
        id: `addr_voice_${crypto.randomBytes(4).toString('hex')}`,
        label: 'Voice Order',
        fullAddress: delivery_address || 'To be confirmed at delivery',
        lat: 0,
        lng: 0,
        pincode: '',
        city: shopData.city || 'Thanjavur',
      },
      notes: `📞 Voice Order | Customer: ${customer_name || 'Unknown'} | Phone: ${customer_phone}`,
      orderSource: 'voice_call',
      sourceCallId: call_id || null,
      customerPhone: customer_phone,
      customerName: customer_name || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Write to orders collection
    const orderRef = await db.collection('orders').add(orderData);
    const orderId = orderRef.id;

    // Generate readable order number
    const orderNumber = `NOE-${Date.now().toString(36).toUpperCase()}`;
    await orderRef.update({ orderNumber });

    // Update active call record
    if (call_id && activeCalls.has(call_id)) {
      const callRecord = activeCalls.get(call_id);
      callRecord.linkedOrderId = orderId;
      callRecord.outcome = 'order_created';
    }

    // Send SMS confirmation
    await sendSmsConfirmation(customer_phone, {
      orderId,
      orderNumber,
      shopName,
      items: orderItems,
      total,
      eta: '25-35 min',
    });

    // Notify shop via Socket.IO
    if (global.io) {
      global.io.to(`user-${shop_id}`).emit('order-received', {
        orderId,
        orderNumber,
        source: 'voice_call',
        items: orderItems,
        total,
      });
    }

    // Notify admin
    if (global.io) {
      global.io.to('role-admin').emit('voice-order-created', {
        orderId,
        orderNumber,
        shopName,
        total,
        customerPhone: customer_phone,
      });
    }

    res.json({
      success: true,
      orderId,
      orderNumber,
      orderTotal: total,
      estimatedDelivery: '25-35 minutes',
      message: `Order placed successfully! Total: ₹${total}`,
    });
  } catch (error) {
    console.error('❌ Create voice order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/voice/vendor-action
 * Vendor accepts or rejects the order
 * Called from noe-vendor app when vendor taps Accept/Reject
 */
router.post('/vendor-action', async (req, res) => {
  try {
    const { order_id, action, rejection_reason, estimated_time } = req.body;

    if (!order_id || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'order_id and action (accept/reject) required' });
    }

    const orderRef = db.collection('orders').doc(order_id);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const orderData = orderDoc.data();

    if (action === 'accept') {
      // Update order status
      await orderRef.update({
        status: 'accepted',
        vendorAcceptedAt: FieldValue.serverTimestamp(),
        estimatedPrepTime: estimated_time || 15, // minutes
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Send SMS to customer: "Your order is accepted!"
      await sendSmsConfirmation(orderData.customerPhone, {
        summary: `Namma Ooru Express: ${orderData.shopName} accepted your order! Preparing now. Delivery in ${estimated_time || 25}-${(estimated_time || 25) + 15} min.`,
      });

      // Find and notify nearby riders
      await notifyNearbyRiders(order_id, orderData);

      // Notify admin
      if (global.io) {
        global.io.to('role-admin').emit('order-accepted', { orderId: order_id, shopName: orderData.shopName });
      }

      console.log(`✅ Vendor ACCEPTED order ${order_id}`);
      res.json({ success: true, message: 'Order accepted, finding rider...' });

    } else {
      // Reject
      await orderRef.update({
        status: 'rejected_by_vendor',
        rejectionReason: rejection_reason || 'Items not available',
        vendorRejectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // SMS to customer
      await sendSmsConfirmation(orderData.customerPhone, {
        summary: `Namma Ooru Express: Sorry, ${orderData.shopName} cannot fulfill your order (${rejection_reason || 'items unavailable'}). Please try again.`,
      });

      console.log(`❌ Vendor REJECTED order ${order_id}: ${rejection_reason}`);
      res.json({ success: true, message: 'Order rejected, customer notified' });
    }
  } catch (error) {
    console.error('❌ Vendor action error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/voice/rider-action
 * Rider accepts or rejects the delivery assignment
 * Called from rider dashboard when rider taps Accept
 */
router.post('/rider-action', async (req, res) => {
  try {
    const { order_id, rider_id, action } = req.body;

    if (!order_id || !rider_id || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'order_id, rider_id, and action required' });
    }

    const orderRef = db.collection('orders').doc(order_id);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const orderData = orderDoc.data();

    if (action === 'accept') {
      // Get rider details
      const riderDoc = await db.collection('users').doc(rider_id).get();
      const riderData = riderDoc.exists ? riderDoc.data() : {};

      await orderRef.update({
        status: 'rider_assigned',
        riderId: rider_id,
        riderName: riderData.displayName || 'Rider',
        riderPhone: riderData.phone || '',
        riderAcceptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // SMS to customer with rider info
      await sendSmsConfirmation(orderData.customerPhone, {
        summary: `Namma Ooru Express: Rider ${riderData.displayName || ''} assigned! Pickup soon. Track: noe.app/track/${order_id}`,
      });

      // Notify vendor that rider is coming
      if (global.io) {
        global.io.to(`user-${orderData.shopId}`).emit('rider-assigned', {
          orderId: order_id,
          riderName: riderData.displayName,
          riderPhone: riderData.phone,
        });
      }

      console.log(`🏍️ Rider ${rider_id} ACCEPTED order ${order_id}`);
      res.json({ success: true, message: 'Delivery accepted!' });

    } else {
      // Rider rejected — find another rider
      console.log(`⚠️ Rider ${rider_id} rejected order ${order_id}, finding another...`);
      await notifyNearbyRiders(order_id, orderData, [rider_id]);
      res.json({ success: true, message: 'Finding another rider...' });
    }
  } catch (error) {
    console.error('❌ Rider action error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Notify nearby riders about a new delivery
 */
async function notifyNearbyRiders(orderId, orderData, excludeRiders = []) {
  try {
    // Get online riders in the area
    const ridersSnap = await db.collection('users')
      .where('role', '==', 'rider')
      .where('isActive', '==', true)
      .limit(5)
      .get();

    const availableRiders = ridersSnap.docs
      .filter(doc => !excludeRiders.includes(doc.id))
      .map(doc => ({ id: doc.id, ...doc.data() }));

    if (availableRiders.length === 0) {
      console.warn(`⚠️ No available riders for order ${orderId}`);
      return;
    }

    // Notify via Socket.IO
    if (global.io) {
      availableRiders.forEach(rider => {
        global.io.to(`user-${rider.id}`).emit('new-delivery-request', {
          orderId,
          shopName: orderData.shopName,
          shopAddress: orderData.address?.fullAddress || '',
          itemCount: orderData.items?.length || 0,
          total: orderData.total || 0,
          customerArea: orderData.address?.city || 'Thanjavur',
        });
      });
    }

    console.log(`📱 Notified ${availableRiders.length} riders for order ${orderId}`);
  } catch (e) {
    console.error('Notify riders error:', e.message);
  }
}

/**
 * POST /api/voice/transfer-human
 * Tool: transfer_to_human — warm handoff to human agent
 */
router.post('/transfer-human', async (req, res) => {
  try {
    const { call_id, reason, context_summary } = req.body;

    console.log(`🙋 Transfer to human: call=${call_id}, reason=${reason}`);

    const callRecord = activeCalls.get(call_id);

    // Create escalation record
    const escalation = {
      id: `esc_${crypto.randomBytes(8).toString('hex')}`,
      callId: call_id,
      reason,
      escalatedAt: new Date().toISOString(),
      status: 'queued',
      agentId: null,
      agentName: null,
      resolution: null,
      resolutionTime: null,
      callContext: {
        transcript: callRecord?.transcript || [],
        partialOrder: callRecord?.partialOrder || null,
        customerPhone: callRecord?.callerPhone || '',
        customerName: callRecord?.customerName || null,
        contextSummary: context_summary || '',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save escalation to Firestore
    await saveHumanEscalation(escalation);

    // Update call record
    if (callRecord) {
      callRecord.escalatedToHuman = true;
      callRecord.escalationReason = reason;
      callRecord.outcome = 'escalated_to_human';
    }

    // Notify admin via Socket.IO
    if (global.io) {
      global.io.to('role-admin').emit('voice-escalation', escalation);
      global.io.to('role-support').emit('voice-escalation', escalation);
    }

    res.json({
      success: true,
      escalationId: escalation.id,
      action: 'transfer_call',
      message: 'Transferring to human agent',
      transferTo: process.env.HUMAN_AGENT_QUEUE_NUMBER || '+919566700534',
    });
  } catch (error) {
    console.error('❌ Transfer to human error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/voice/send-sms
 * Tool: send_sms_confirmation
 */
router.post('/send-sms', async (req, res) => {
  try {
    const { customer_phone, order_summary, order_id } = req.body;

    console.log(`📱 Send SMS: phone=${customer_phone}`);

    await sendSmsConfirmation(customer_phone, {
      orderId: order_id,
      summary: order_summary,
    });

    res.json({ success: true, message: 'SMS sent' });
  } catch (error) {
    console.error('❌ Send SMS error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── ADMIN ENDPOINTS ─────────────────────────────────────────

/**
 * GET /api/voice/admin/calls
 * Admin: List all voice calls with filters
 */
router.get('/admin/calls', async (req, res) => {
  try {
    const { outcome, date_from, date_to, page = 1, limit = 20 } = req.query;

    const calls = await getVoiceCalls({
      outcome,
      dateFrom: date_from,
      dateTo: date_to,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      calls: calls.data,
      total: calls.total,
      page: parseInt(page),
      totalPages: Math.ceil(calls.total / parseInt(limit)),
    });
  } catch (error) {
    console.error('❌ Admin calls error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/voice/admin/analytics
 * Admin: Voice call analytics dashboard data
 */
router.get('/admin/analytics', async (req, res) => {
  try {
    const { period = '7d' } = req.query;

    const analytics = await getVoiceAnalytics(period);

    res.json({
      success: true,
      analytics,
    });
  } catch (error) {
    console.error('❌ Admin analytics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/voice/admin/calls/:id/transcript
 * Admin: Get full transcript for a specific call
 */
router.get('/admin/calls/:id/transcript', async (req, res) => {
  try {
    const { id } = req.params;
    const transcript = await getCallTranscript(id);

    res.json({
      success: true,
      transcript,
    });
  } catch (error) {
    console.error('❌ Get transcript error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/voice/admin/escalations
 * Admin: List human escalations
 */
router.get('/admin/escalations', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const escalations = await getEscalations({
      status,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      escalations: escalations.data,
      total: escalations.total,
    });
  } catch (error) {
    console.error('❌ Escalations error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/voice/admin/escalations/:id/resolve
 * Admin: Resolve an escalation
 */
router.put('/admin/escalations/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { agentId, agentName, resolution } = req.body;

    await db.collection('human_escalations').doc(id).update({
      status: 'resolved',
      agentId: agentId || 'admin',
      agentName: agentName || 'Admin',
      resolution: resolution || 'Resolved by admin',
      resolutionTime: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, message: 'Escalation resolved' });
  } catch (error) {
    console.error('❌ Resolve escalation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/voice/admin/live-calls
 * Admin: Get currently active calls
 */
router.get('/admin/live-calls', (req, res) => {
  const liveCalls = Array.from(activeCalls.values()).map(call => ({
    id: call.id,
    callId: call.callId,
    phone: call.callerPhone,
    startTime: call.startTime,
    duration: Math.floor((Date.now() - new Date(call.startTime).getTime()) / 1000),
    language: call.detectedLanguage,
    turnCount: call.turnIndex,
    status: call.outcome,
  }));

  res.json({
    success: true,
    liveCalls,
    count: liveCalls.length,
  });
});

// ─── DATABASE FUNCTIONS (REAL FIRESTORE) ─────────────────────

/**
 * Get customer voice profile from Firestore
 */
async function getCustomerVoiceProfile(phone) {
  try {
    // Normalize phone number
    const normalizedPhone = phone.replace(/\D/g, '').slice(-10);
    
    const snap = await db.collection('customer_voice_profiles').doc(normalizedPhone).get();
    if (snap.exists) {
      return { phoneNumber: phone, ...snap.data() };
    }
    
    // Also check by full phone number
    const snap2 = await db.collection('customer_voice_profiles').doc(phone).get();
    if (snap2.exists) {
      return { phoneNumber: phone, ...snap2.data() };
    }
    
    return null;
  } catch (e) {
    console.error('Get voice profile error:', e.message);
    return null;
  }
}

/**
 * Update/create customer voice profile after successful call
 */
async function updateCustomerVoiceProfile(phone, callRecord) {
  try {
    const normalizedPhone = phone.replace(/\D/g, '').slice(-10);
    
    const profileRef = db.collection('customer_voice_profiles').doc(normalizedPhone);
    const existing = await profileRef.get();
    
    const updateData = {
      phoneNumber: phone,
      lastOrderId: callRecord.linkedOrderId || null,
      preferredLanguage: callRecord.detectedLanguage || 'ta',
      totalVoiceOrders: existing.exists 
        ? FieldValue.increment(1) 
        : 1,
      updatedAt: new Date().toISOString(),
    };
    
    if (callRecord.customerName) {
      updateData.knownName = callRecord.customerName;
    }
    
    if (!existing.exists) {
      updateData.createdAt = new Date().toISOString();
      updateData.frequentItems = [];
    }
    
    await profileRef.set(updateData, { merge: true });
    console.log(`✅ Voice profile updated for ${normalizedPhone}`);
  } catch (e) {
    console.error('Profile update error:', e.message);
  }
}

/**
 * Save voice call record to Firestore
 */
async function saveVoiceCall(callRecord) {
  try {
    const docData = {
      ...callRecord,
      // Calculate AI confidence score from transcript turns
      aiConfidenceScore: calculateAverageConfidence(callRecord.transcript),
      savedAt: FieldValue.serverTimestamp(),
    };
    
    await db.collection('voice_calls').doc(callRecord.id).set(docData);
    console.log(`✅ Voice call saved: ${callRecord.id}`);
  } catch (e) {
    console.error('Save voice call error:', e.message);
  }
}

/**
 * Save human escalation to Firestore
 */
async function saveHumanEscalation(escalation) {
  try {
    await db.collection('human_escalations').doc(escalation.id).set(escalation);
    console.log(`✅ Escalation saved: ${escalation.id}`);
  } catch (e) {
    console.error('Save escalation error:', e.message);
  }
}

/**
 * Search shops by area and category — REAL Firestore query
 */
async function searchShopsForVoice(area, itemCategory, itemName) {
  try {
    let query = db.collection('shops')
      .where('isApproved', '==', true);
    
    // Filter by category if provided
    if (itemCategory) {
      query = query.where('categoryId', '==', itemCategory);
    }
    
    // Get shops — limit to 10 candidates
    const snap = await query.orderBy('rating', 'desc').limit(10).get();
    
    if (snap.empty) {
      // Fallback: get all approved shops
      const fallback = await db.collection('shops')
        .where('isApproved', '==', true)
        .orderBy('rating', 'desc')
        .limit(5)
        .get();
      
      return fallback.docs.map(doc => formatShopResult(doc));
    }
    
    // Filter by area (fuzzy match on address/area fields)
    const normalizedArea = (area || '').toLowerCase().trim();
    let results = snap.docs.map(doc => formatShopResult(doc));
    
    if (normalizedArea) {
      const areaMatched = results.filter(shop => {
        const shopArea = (shop.area || shop.address || '').toLowerCase();
        const shopCity = (shop.city || '').toLowerCase();
        return shopArea.includes(normalizedArea) || 
               shopCity.includes(normalizedArea) ||
               normalizedArea.includes(shopCity);
      });
      
      // If area filtering finds results, use them; otherwise return all
      if (areaMatched.length > 0) {
        results = areaMatched;
      }
    }
    
    return results.slice(0, 5);
  } catch (e) {
    console.error('Search shops error:', e.message);
    return [];
  }
}

function formatShopResult(doc) {
  const data = doc.data();
  return {
    shopId: doc.id,
    shopName: data.name || data.shopName || 'Unknown Shop',
    area: data.area || data.address || '',
    city: data.city || 'Thanjavur',
    distance: data.distance || '—',
    rating: data.rating || 4.0,
    isOpen: data.isOpen !== false,
    hasRequestedItems: true, // Will be refined with item search
    categoryId: data.categoryId || '',
    phone: data.phone || '',
  };
}

/**
 * Search items within a shop — REAL Firestore query with fuzzy matching
 */
async function searchItemInShop(shopId, itemQuery) {
  try {
    // Get all available products for this shop
    const snap = await db.collection('products')
      .where('shopId', '==', shopId)
      .where('isAvailable', '==', true)
      .limit(100)
      .get();
    
    if (snap.empty) {
      // Try without isAvailable filter (in case field doesn't exist)
      const fallback = await db.collection('products')
        .where('shopId', '==', shopId)
        .limit(100)
        .get();
      
      if (fallback.empty) return [];
      return fuzzyMatchItems(fallback.docs, itemQuery);
    }
    
    return fuzzyMatchItems(snap.docs, itemQuery);
  } catch (e) {
    console.error('Search item error:', e.message);
    return [];
  }
}

/**
 * Fuzzy match items against a query string
 */
function fuzzyMatchItems(docs, query) {
  const normalizedQuery = (query || '').toLowerCase().trim();
  const queryWords = normalizedQuery.split(/\s+/);
  
  const scored = docs.map(doc => {
    const data = doc.data();
    const name = (data.name || '').toLowerCase();
    const nameTamil = (data.nameTamil || '').toLowerCase();
    const category = (data.category || '').toLowerCase();
    const brand = (data.brand || '').toLowerCase();
    
    let score = 0;
    
    // Exact name match
    if (name.includes(normalizedQuery) || nameTamil.includes(normalizedQuery)) {
      score += 100;
    }
    
    // Word-level matching
    queryWords.forEach(word => {
      if (word.length < 2) return;
      if (name.includes(word)) score += 30;
      if (nameTamil.includes(word)) score += 30;
      if (category.includes(word)) score += 15;
      if (brand.includes(word)) score += 20;
    });
    
    return { doc, data, score };
  });
  
  // Filter to items with some match and sort by score
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(item => ({
      productId: item.doc.id,
      name: item.data.name || '',
      nameTamil: item.data.nameTamil || item.data.name || '',
      price: item.data.price || item.data.sellingPrice || 0,
      discountPrice: item.data.discountPrice || null,
      unit: item.data.unit || 'piece',
      isAvailable: item.data.isAvailable !== false,
      stockQuantity: item.data.stockQuantity || item.data.stock || 0,
      brand: item.data.brand || '',
      category: item.data.category || '',
      variants: item.data.variants || [],
    }));
}

/**
 * Get customer's last order by phone number
 */
async function getLastOrderByPhone(phone) {
  try {
    const normalizedPhone = phone.replace(/\D/g, '').slice(-10);
    
    // Try customerPhone field first
    let snap = await db.collection('orders')
      .where('customerPhone', '==', phone)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    
    if (snap.empty) {
      // Try with normalized phone
      snap = await db.collection('orders')
        .where('customerPhone', '==', `+91${normalizedPhone}`)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
    }
    
    if (snap.empty) {
      // Try userId pattern for voice users
      snap = await db.collection('orders')
        .where('userId', '==', `voice_${normalizedPhone}`)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
    }
    
    if (snap.empty) return null;
    
    const doc = snap.docs[0];
    const data = doc.data();
    
    return {
      orderId: doc.id,
      orderNumber: data.orderNumber || doc.id,
      shopName: data.shopName || 'Unknown',
      shopId: data.shopId,
      items: (data.items || []).map(item => ({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit || 'piece',
        price: item.price || 0,
      })),
      total: data.total || 0,
      status: data.status,
      createdAt: data.createdAt?.toDate?.() 
        ? data.createdAt.toDate().toISOString() 
        : data.createdAt || '',
    };
  } catch (e) {
    console.error('Get last order error:', e.message);
    return null;
  }
}

/**
 * Send SMS confirmation (placeholder — connect to MSG91/Exotel)
 */
async function sendSmsConfirmation(phone, data) {
  try {
    const message = data.summary || 
      `Namma Ooru Express: Order #${data.orderNumber || data.orderId || 'NEW'} placed at ${data.shopName || 'shop'}! ` +
      `Total: ₹${data.total || 0}. Delivery in ${data.eta || '30 min'}.`;
    
    console.log(`📱 SMS to ${phone}: ${message}`);
    
    // ━━━━ SMS PROVIDER INTEGRATION POINT ━━━━
    // Uncomment and configure when SMS provider is set up:
    //
    // --- OPTION A: MSG91 ---
    // const msg91 = require('msg91').default;
    // await msg91.sendSMS(phone, message, 'NOE', '4');
    //
    // --- OPTION B: Exotel ---
    // const axios = require('axios');
    // await axios.post(`https://api.exotel.com/v1/Accounts/${EXOTEL_SID}/Sms/send`, {
    //   From: EXOTEL_PHONE,
    //   To: phone,
    //   Body: message,
    // }, { auth: { username: EXOTEL_SID, password: EXOTEL_TOKEN } });
    //
    // --- OPTION C: Twilio ---
    // const twilio = require('twilio')(TWILIO_SID, TWILIO_TOKEN);
    // await twilio.messages.create({ body: message, from: TWILIO_PHONE, to: phone });
    
    // Log SMS to Firestore for audit
    await db.collection('sms_logs').add({
      phone,
      message,
      data: JSON.stringify(data),
      sentAt: FieldValue.serverTimestamp(),
      status: 'sent', // Will be 'sent' once provider is integrated
    });
    
    return true;
  } catch (e) {
    console.error('Send SMS error:', e.message);
    return false;
  }
}

/**
 * Get voice calls with filters and pagination
 */
async function getVoiceCalls(filters) {
  try {
    let query = db.collection('voice_calls').orderBy('createdAt', 'desc');
    
    if (filters.outcome) {
      query = query.where('outcome', '==', filters.outcome);
    }
    
    if (filters.dateFrom) {
      query = query.where('createdAt', '>=', filters.dateFrom);
    }
    
    if (filters.dateTo) {
      query = query.where('createdAt', '<=', filters.dateTo);
    }
    
    // Get total count (approximate)
    const countSnap = await query.count().get();
    const total = countSnap.data().count;
    
    // Paginate
    const offset = (filters.page - 1) * filters.limit;
    const snap = await query.offset(offset).limit(filters.limit).get();
    
    const data = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    return { data, total };
  } catch (e) {
    console.error('Get voice calls error:', e.message);
    return { data: [], total: 0 };
  }
}

/**
 * Get voice analytics — aggregated data
 */
async function getVoiceAnalytics(period) {
  try {
    // Calculate date range
    const now = new Date();
    let startDate;
    switch (period) {
      case '1d': startDate = new Date(now - 24 * 60 * 60 * 1000); break;
      case '7d': startDate = new Date(now - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': startDate = new Date(now - 30 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
    }
    
    // Query all calls in the period
    const snap = await db.collection('voice_calls')
      .where('createdAt', '>=', startDate.toISOString())
      .orderBy('createdAt', 'desc')
      .get();
    
    const calls = snap.docs.map(doc => doc.data());
    
    const totalCalls = calls.length;
    const successfulOrders = calls.filter(c => c.outcome === 'order_created').length;
    const escalatedCalls = calls.filter(c => c.outcome === 'escalated_to_human').length;
    const abandonedCalls = calls.filter(c => c.outcome === 'abandoned').length;
    
    const durations = calls.filter(c => c.duration > 0).map(c => c.duration);
    const averageHandleTime = durations.length > 0 
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    
    const confidences = calls.filter(c => c.aiConfidenceScore > 0).map(c => c.aiConfidenceScore);
    const averageConfidenceScore = confidences.length > 0
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : 0;
    
    const successRate = totalCalls > 0 ? Math.round((successfulOrders / totalCalls) * 100 * 10) / 10 : 0;
    const escalationRate = totalCalls > 0 ? Math.round((escalatedCalls / totalCalls) * 100 * 10) / 10 : 0;
    
    // Peak hours
    const hourCounts = {};
    calls.forEach(c => {
      const hour = new Date(c.startTime).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const peakHours = Object.entries(hourCounts).map(([hour, count]) => ({
      hour: parseInt(hour),
      count,
    })).sort((a, b) => a.hour - b.hour);
    
    // Language distribution
    const langCounts = {};
    calls.forEach(c => {
      const lang = c.detectedLanguage || 'ta';
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    });
    const languageDistribution = Object.entries(langCounts).map(([language, count]) => ({
      language,
      count,
    }));
    
    // Daily trend
    const dailyCounts = {};
    calls.forEach(c => {
      const date = c.startTime?.split('T')[0] || '';
      if (!dailyCounts[date]) dailyCounts[date] = { calls: 0, orders: 0 };
      dailyCounts[date].calls++;
      if (c.outcome === 'order_created') dailyCounts[date].orders++;
    });
    const dailyTrend = Object.entries(dailyCounts).map(([date, data]) => ({
      date,
      calls: data.calls,
      orders: data.orders,
    })).sort((a, b) => a.date.localeCompare(b.date));
    
    return {
      totalCalls,
      successfulOrders,
      escalatedCalls,
      abandonedCalls,
      averageHandleTime,
      averageConfidenceScore,
      successRate,
      escalationRate,
      peakHours,
      languageDistribution,
      topItems: [], // TODO: aggregate from orders
      dailyTrend,
    };
  } catch (e) {
    console.error('Get voice analytics error:', e.message);
    return {
      totalCalls: 0, successfulOrders: 0, escalatedCalls: 0, abandonedCalls: 0,
      averageHandleTime: 0, averageConfidenceScore: 0, successRate: 0, escalationRate: 0,
      peakHours: [], languageDistribution: [], topItems: [], dailyTrend: [],
    };
  }
}

/**
 * Get call transcript by call ID
 */
async function getCallTranscript(callId) {
  try {
    const doc = await db.collection('voice_calls').doc(callId).get();
    if (!doc.exists) return [];
    
    const data = doc.data();
    return data.transcript || [];
  } catch (e) {
    console.error('Get transcript error:', e.message);
    return [];
  }
}

/**
 * Get human escalations with filters
 */
async function getEscalations(filters) {
  try {
    let query = db.collection('human_escalations').orderBy('escalatedAt', 'desc');
    
    if (filters.status) {
      query = query.where('status', '==', filters.status);
    }
    
    const countSnap = await query.count().get();
    const total = countSnap.data().count;
    
    const offset = (filters.page - 1) * filters.limit;
    const snap = await query.offset(offset).limit(filters.limit).get();
    
    const data = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    return { data, total };
  } catch (e) {
    console.error('Get escalations error:', e.message);
    return { data: [], total: 0 };
  }
}

/**
 * Calculate average AI confidence from transcript turns
 */
function calculateAverageConfidence(transcript) {
  if (!transcript || !transcript.length) return 0;
  
  const customerTurns = transcript.filter(t => t.speaker === 'customer' && t.confidence > 0);
  if (customerTurns.length === 0) return 0;
  
  const total = customerTurns.reduce((sum, turn) => sum + turn.confidence, 0);
  return Math.round(total / customerTurns.length);
}

module.exports = router;
