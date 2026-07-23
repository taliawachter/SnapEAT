# 🍽️ SnapEat – AI Nutrition Assistant

SnapEat is an AI-powered nutrition assistant that helps users analyze meals, track nutrition, and receive personalized dietary guidance.

The system combines computer vision, barcode recognition, conversational AI, and long-term memory to create an intelligent nutrition companion.

---

## ✨ Features

* 📸 Meal analysis from images using AI
* 🥗 Automatic calorie and macronutrient estimation
* 📦 Barcode scanning for packaged food products
* 💬 AI-powered nutrition chatbot
* 🧠 Long-term conversation memory
* 📚 Retrieval-Augmented Generation (RAG) knowledge base
* ❤️ Save meals to personal history
* 🔐 Secure Firebase Authentication (Google Sign-In)
* ☁️ Firebase Firestore integration
* 📱 Responsive React interface
* 🤖 WhatsApp Bot integration

---

# 🏗️ Architecture

```
React Frontend
        │
        ▼
Firebase Authentication
        │
        ▼
Express / Node.js Backend
        │
 ┌──────┴──────────────┐
 │                     │
 ▼                     ▼
OpenAI API        Firebase Firestore
 │                     │
 ▼                     ▼
Meal Analysis     User Data & Memory
 │
 ▼
Nutrition Results
```

The WhatsApp Bot communicates with the backend and uses the same AI services, memory system, and nutrition knowledge base.

---

# 🛠️ Tech Stack

### Frontend

* React
* JavaScript
* Vite
* CSS

### Backend

* Node.js
* Express

### Database

* Firebase Firestore

### Authentication

* Firebase Authentication
* Google Sign-In

### AI

* OpenAI API
* Retrieval-Augmented Generation (RAG)
* Long-Term Conversation Memory

### External APIs

* Open Food Facts
* WhatsApp (Baileys)

### Testing

* Node Test Runner
* Integration Tests
* Unit Tests

---

# 📂 Project Structure

```
SnapEat/
│
├── src/                  # React application
├── bot/                  # WhatsApp bot
├── public/
├── shared/
├── server/
├── tests/
└── README.md
```

---

# 🚀 Getting Started

Clone the repository:

```bash
git clone https://github.com/taliawachter/SnapEAT.git
cd SnapEAT
```

Install dependencies:

```bash
npm install
```

Run the React application:

```bash
npm run dev
```

The WhatsApp Bot can be started from the **bot** directory after configuring the required environment variables.

---

# 🔒 Environment Variables

Create a `.env` file and configure the required variables.

Example:

```env
OPENAI_API_KEY=your_api_key
FIREBASE_API_KEY=your_api_key
```

Sensitive credentials are intentionally excluded from this repository.

---

# 🎯 Key Capabilities

* AI-powered meal recognition
* Nutrition estimation
* Personalized dietary recommendations
* Persistent conversation memory
* Context-aware chatbot
* Barcode product lookup
* Secure cloud storage
* Cross-platform architecture

---

# 👩‍💻 Author

**Talia Wachter**

Computer Science Student

GitHub:
https://github.com/taliawachter
