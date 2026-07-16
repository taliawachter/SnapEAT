# SNAP EAT Bot Backend

## Nutrition Knowledge Base

### Architecture
The backend keeps the existing WhatsApp, Baileys, Firebase, memory, and meal-analysis flows intact.
A lightweight deterministic router checks whether an incoming user message is a general nutrition-information question.
If yes, the bot calls the OpenAI Responses API with hosted file_search against a configured OpenAI Vector Store.
If no, it keeps using the existing conversation flow and prompt logic.
If the knowledge flow is unavailable due to missing config, the bot falls back to the existing reply flow.
If the external API fails, the bot returns a safe Hebrew fallback and does not crash.

### Required Environment Variables
Set these in the local bot environment:
OPENAI_API_KEY=
OPENAI_VECTOR_STORE_ID=
OPENAI_MODEL=
OPENAI_FILE_SEARCH_MAX_RESULTS=5

Other existing bot variables are still required (Firebase, allowlist, port, etc.).

### Knowledge Document Location
Knowledge source file:
bot/knowledge/snap-eat-nutrition-knowledge.md

### Review And Edit Process
1. Edit the knowledge markdown file in Hebrew.
2. Keep content factual and general.
3. Do not add unsupported numeric prescriptions.
4. Review with a registered dietitian before clinical or production use.

### Create The Vector Store
Run from bot folder:
npm run knowledge:create

The script uploads the knowledge file, creates a Vector Store named:
snap-eat-nutrition-knowledge

Then it prints the Vector Store ID.

### Where To Put The Vector Store ID
Copy the printed ID into:
OPENAI_VECTOR_STORE_ID

### Start The Bot
Run from bot folder:
npm start

### Run Tests
Run from bot folder:
npm test

### Sample Hebrew Questions
- איך נראית ארוחה מאוזנת?
- מה הם מקורות טובים לחלבון?
- מה ההבדל בין פחמימות פשוטות למורכבות?
- למה חשוב לשתות מים?
- איך לרדת במשקל בצורה הדרגתית?

### Expected Safe Responses
- Uses approved knowledge retrieval when available.
- Explicitly states when verified information is insufficient.
- Labels estimates clearly.
- Avoids medical diagnosis and medication advice.
- Recommends a qualified professional in higher-risk contexts.

### Known Limitations
- Image-based nutrition estimates are approximate and not exact measurements.
- Knowledge quality depends on the markdown source content and review quality.
- Missing OpenAI knowledge config will route to the existing default reply flow.

### Important Warnings
- Do not run knowledge:create repeatedly without intent; each run may create duplicate Vector Stores.
- The initial nutrition knowledge content must be reviewed by a registered dietitian before clinical or production use.

## Packaged Product Lookup

### Architecture
For a specific packaged product (identified by barcode), SNAP EAT does **not** use the RAG nutrition
knowledge base and never asks the language model to invent calories or macros. Instead:

```
User sends/enters a barcode
  -> validate barcode (bot/services/food-product.service.js: normalizeBarcode)
  -> look up the product on Open Food Facts (getProductByBarcode)
  -> product not found / API unavailable -> safe Hebrew fallback, ask for a label photo
  -> product found but core nutrition incomplete -> safe Hebrew fallback, ask for a label photo
  -> show product identity + per-100g values (formatProductNutritionForUser)
  -> ask how much was consumed (grams or a package fraction)
  -> parse the amount deterministically (bot/services/product-amount.helper.js)
  -> calculate nutrition in JavaScript (calculateNutritionForWeight / calculateNutritionForPackageFraction)
  -> show a confirmation summary and ask "להוסיף את המוצר לארוחה? כן/לא"
  -> save to Firestore only after explicit "כן"
```

Conversation state for this flow reuses the bot's existing in-memory `pending` map (the same pattern
used for meal-image clarification), keyed by WhatsApp chat id, with steps:
`awaiting_product_barcode` -> `awaiting_product_amount` -> `awaiting_product_confirmation` ->
`awaiting_product_meal_type` (to pick breakfast/lunch/dinner/snack, matching the existing meal schema).

### Barcode Input Examples
- "ברקוד 7290000000000"
- "חפש מוצר לפי ברקוד 7290000000000"
- "סרקתי 7290000000000"
- A barcode-only message (just digits), but only while the bot is explicitly waiting for one

A bare number typed during normal conversation is never treated as a barcode unless the user used an
explicit keyword (ברקוד / סרקתי / סריקה / סרוק) or the conversation is already in a step that expects one.

### Open Food Facts Source & Collaborative-Database Limitation
Product data comes from the free, collaborative [Open Food Facts](https://world.openfoodfacts.org)
database (API v2, no API key required). Because it is community-maintained, SNAP EAT never claims the
data is guaranteed accurate. Every response is phrased as "לפי נתוני התווית השמורים במאגר..." and the
barcode, source, last-modified date, and any data-quality tags are preserved alongside the calculation.

### Nutrition Per 100g & Quantity Calculation
All nutrition values are normalized to per-100g. Calories prefer `energy-kcal_100g`; if only `energy_100g`
(kJ) is available it is converted to kcal in code. Missing values stay `null` — they are never replaced
with zero and the model never fills gaps with general knowledge. Consumed-quantity calculations
(`nutrient per 100g x grams / 100`) run as plain, deterministic JavaScript, not a model call.

### Confirmation Before Saving
Nothing is written to Firestore until the user explicitly answers "כן" to the confirmation summary.
Saying "לא", "ביטול", "בטל", or "עזוב" at any point cancels the pending product without saving anything.

### Label-Photo Fallback
If the product isn't found, the database is unreachable, or the core nutrition fields (calories, protein,
carbohydrates, fat) are missing, the bot asks for a clear photo of the product's nutrition label instead
of guessing.

### Run Tests
Run from bot folder:
```
npm test
```
This also runs `bot/tests/food-product.service.test.js` and `bot/tests/product-amount.helper.test.js`,
which mock `fetch` and make no real network calls to Open Food Facts.

### Manual Hebrew Tests
With the bot running and connected to an allowlisted WhatsApp number, try:
1. "ברקוד 7290000000000" — a real, complete product should show name, brand, per-100g values, and the
   database-source disclaimer, then ask "כמה אכלת?".
2. A barcode for a product with incomplete nutrition data — should return the "אינם מלאים" fallback.
3. A barcode that doesn't exist in Open Food Facts — should return the "לא מצאתי את המוצר" fallback.
4. "125 גרם" — should calculate and show a confirmation summary.
5. "חצי אריזה" / "אריזה שלמה" — should calculate using the package weight when known.
6. "כף אחת" — should ask for grams or a package fraction instead of guessing.
7. "לא" at the confirmation step — should cancel without saving.
8. "כן" at the confirmation step, then a valid meal type — should save and confirm without exposing any
   Firestore id.
9. A normal conversational message and a general nutrition question (e.g. "מה הם מקורות טובים לחלבון?")
   should continue to work exactly as before.
10. Sending a meal photo should continue to trigger the existing image meal-analysis flow.

### Known Limitations
- Open Food Facts is collaboratively maintained; label data quality varies by product and region.
- Package-weight parsing only converts grams/kg confidently; ml/l use an approximate 1:1 density
  fallback, and unrecognized units are treated as unknown (package-fraction amounts then require the
  user to provide grams instead).
- A product with any of calories, protein, carbohydrates, or fat missing is treated as incomplete and the
  bot asks for a label photo rather than estimating the gap.
