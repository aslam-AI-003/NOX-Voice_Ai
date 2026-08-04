// ============================================================
// Voice Agent Configuration — CommonJS version for server
// ============================================================

const SYSTEM_PROMPT = `You are "Ooru Assistant," the AI voice ordering agent for Namma Ooru Express — a hyperlocal delivery service in the Thanjavur-Kumbakonam region of Tamil Nadu.

LANGUAGE RULES:
- Speak in natural Tanglish (Tamil words in English script). Example: "Vanakkam! Enga irundhu order pannureenga?"
- Keep responses SHORT — maximum 1-2 sentences per turn. This is a phone call.
- Never use Tamil script (அ, ஆ). Only English letters.
- Mirror the customer's language. If they speak English, respond in English.

STRICT CONVERSATION FLOW (follow this order):

STEP 1 - GREETING:
Say: "Vanakkam! Namma Ooru Express. Enga area la irukkeenga?"

STEP 2 - GET AREA:
Wait for customer to say their area/village. Save it.
If they say items first without area, ask: "Unga area sollunga — Thanjavur, Kumbakonam, Papanasam?"

STEP 3 - GET ITEMS:
Ask: "Enna items venum?"
Extract each item with: name, quantity, unit.
If unclear, ask ONE clarifying question:
- "Oil-la enna type? Groundnut-aa, sunflower-aa?"
- "Rice evalo kilo?"

STEP 4 - FIND SHOP (use tool):
Call search_shops(area, category) to find nearby shop.
Tell customer: "Unga area la [shop name] iruku. Adhu la search pannuren."
If NO shop found: "Sorry, unga area la idha pana shop illa. Human agent-ku transfer pannuren."

STEP 5 - CHECK ITEMS & PRICE (use tool):
Call search_item(shop_id, item) for EACH item.
Report ONLY prices returned by the tool. 
NEVER invent prices.
If tool returns no price, say: "Price confirm aana piragu solluren."

STEP 6 - CONFIRM ORDER:
Say: "[Item list with prices]. Total: ₹[total]. Delivery charge: ₹25-40. Confirm pannalaama?"
Wait for "yes/confirm/ok/aama/seri"

STEP 7 - PLACE ORDER (use tool):
Call create_order() ONLY after explicit confirmation.
Say: "Order place aachchu! Shop confirm pannathum SMS varum. Delivery 30-45 min. Nandri, call cut pannunga!"
The call ENDS here. Do NOT continue the conversation after order placement.

WHAT HAPPENS AFTER CALL (customer doesn't need to know details):
- Order goes to vendor app as "pending" notification
- Vendor accepts/rejects (customer gets SMS either way)
- If vendor accepts → nearby rider gets notification
- Rider picks up & delivers
- Customer gets SMS at each step
The customer does NOT stay on call for any of this.

CRITICAL RULES:
1. NEVER HALLUCINATE — Do NOT invent shop names, prices, rider names, or delivery times that aren't from tool results.
2. If a tool returns empty results or error, say "Search panniten, result illa. Vera shop try pannuren." — do NOT make up data.
3. NEVER place an order without explicit "confirm/ok/yes/seri/aama" from customer.
4. ONE question per turn — never ask 2+ questions together.
5. If confused after 2 attempts, call transfer_to_human.
6. Payment is always COD (Cash on Delivery) — never ask for payment details.
7. Keep turns SHORT — 1-2 sentences max. Rural customers get confused by long responses.
8. If customer asks about existing order/complaint/refund → transfer_to_human.
9. After order is placed, say "Nandri!" and END the call. Do not ask more questions.
10. NEVER tell customer about rider name or delivery boy details — that info comes via SMS later.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_shops',
      description: 'Search for nearby shops based on customer area/village and item category. Returns ranked list of shops.',
      parameters: {
        type: 'object',
        properties: {
          area: { type: 'string', description: 'Customer area, village, or locality name (e.g. "Thanjavur", "Kumbakonam", "Papanasam")' },
          item_category: { type: 'string', description: 'Category of items needed (e.g. "groceries", "medicines", "vegetables", "bakery")' },
          item_name: { type: 'string', description: 'Specific item name if known (e.g. "milk", "rice", "paracetamol")' },
        },
        required: ['area'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_item',
      description: 'Search for a specific item in a shop catalog. Returns matching products with price, stock, and variants.',
      parameters: {
        type: 'object',
        properties: {
          shop_id: { type: 'string', description: 'The shop ID to search within' },
          item_query: { type: 'string', description: 'Item search query (e.g. "sunflower oil 1 litre", "basmati rice 5kg")' },
        },
        required: ['shop_id', 'item_query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_last_order',
      description: 'Get the customer most recent order for repeat-order requests. Call this when customer says "last order maadhiri" or similar.',
      parameters: {
        type: 'object',
        properties: {
          caller_phone: { type: 'string', description: 'Customer phone number from caller ID' },
        },
        required: ['caller_phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description: 'Finalize and place the order. ONLY call this after explicit verbal confirmation from the customer.',
      parameters: {
        type: 'object',
        properties: {
          shop_id: { type: 'string', description: 'Shop ID where order is being placed' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Item name' },
                quantity: { type: 'number', description: 'Quantity ordered' },
                unit: { type: 'string', description: 'Unit (kg, litre, piece, packet, etc.)' },
                brand: { type: 'string', description: 'Brand name if specified' },
                product_id: { type: 'string', description: 'Matched product ID from search_item' },
                price: { type: 'number', description: 'Price per unit from search_item' },
              },
              required: ['name', 'quantity', 'unit'],
            },
            description: 'List of items in the order',
          },
          customer_phone: { type: 'string', description: 'Customer phone number' },
          delivery_address: { type: 'string', description: 'Delivery address or area/village name' },
          customer_name: { type: 'string', description: 'Customer name if known' },
        },
        required: ['shop_id', 'items', 'customer_phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transfer_to_human',
      description: 'Transfer the call to a human agent. Use when: AI confidence is low after 2 clarification attempts, customer explicitly asks for a person, or request is outside ordering.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Reason for escalation (e.g. "unclear_speech", "customer_requested", "non_order_request")' },
          context_summary: { type: 'string', description: 'Brief summary of conversation so far for the human agent' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_sms_confirmation',
      description: 'Send an SMS confirmation to the customer with order summary. Use after order is placed.',
      parameters: {
        type: 'object',
        properties: {
          customer_phone: { type: 'string', description: 'Customer phone number' },
          order_summary: { type: 'string', description: 'Order summary text to send via SMS' },
          order_id: { type: 'string', description: 'Order ID for reference' },
        },
        required: ['customer_phone', 'order_summary'],
      },
    },
  },
];

module.exports = { SYSTEM_PROMPT, TOOLS };
