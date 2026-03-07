# CodeWithMee 🚀  
**AI-Powered Interactive Coding Learning Platform**

CodeWithMee is an AI-powered learning operating system that transforms passive coding education into an active, collaborative, and development-driven experience. Instead of just watching tutorials, users practice in a live sandbox, receive AI guidance, and build real projects inside a social ecosystem.

---

## 📌 Project Overview

CodeWithMee combines learning, development, and collaboration into a single environment.

The platform integrates:

- 🧠 AI mentor with contextual coding assistance
- 💻 Interactive split-screen coding sandbox
- 📚 AI-generated learning roadmaps
- 🤝 Social and collaborative learning features
- 🏗️ AI-powered project scaffolding
- 🎮 Gamification and engagement systems

The goal is to function as a **learning operating system**, not just a website.

---

## ✨ Key Features

### 🤖 AI-Powered Roadmap Generation
Generate personalized step-by-step learning paths based on language and skill level.

### 💻 Interactive Learning Sandbox
Split-screen environment where users can:

- watch YouTube tutorials
- write code simultaneously
- execute Python code in real time
- view output instantly

Powered by Monaco Editor + backend execution engine.

### 🧠 Persistent AI Assistant (“Mee”)
Context-aware AI mentor that:

- explains code
- helps debug logic
- answers questions
- generates learning roadmaps
- provides guided assistance during practice

### 🔐 Secure User System
- JWT authentication
- hashed passwords (bcrypt)
- protected API routes
- persistent sessions

### 🎨 Modern UI/UX
- animated dashboard
- motion-driven interface
- custom cursor & visual effects
- Pomodoro timer
- developer-style workspace

---

## 🏗️ Core Architecture

CodeWithMee follows a modular MERN architecture:

**Frontend**
- React
- Monaco Editor
- Framer Motion
- GSAP animations

**Backend**
- Node.js
- Express.js

**Database**
- MongoDB

**Authentication**
- JWT + BcryptJS

**AI Engine**
- Google Gemini API

**Code Execution**
- Secure Python execution via Piston / python-shell

**Future Layer**
- VS Code extension for IDE integration

The architecture is designed for scalability and ecosystem expansion.

---

## 🏗️ Architecture Diagram

<p align="center">
  <img src="https://raw.githubusercontent.com/ArnavMurdande/CodeWithMee/aef405d65c3066990cd20d46d9fd2572b85e6606/CodeWithMe%20Architecture%20diagram.png" width="900"/>
</p>

---

## ✅ Completed Features

### 1. Interactive Split-Screen Sandbox
Live coding + tutorial viewing with real-time execution.

### 2. Persistent AI Assistant
Gemini-powered mentor integrated into coding workflow.

### 3. Secure Authentication System
JWT login + encrypted user credentials.

### 4. Database Infrastructure
Collections implemented:

- Users
- Challenges
- Submissions
- YouTube Cache

Foundation for gamification & analytics.

### 5. Code Execution Backend
Server-side Python execution engine:

- secure sandboxed execution
- console output capture
- frontend integration

### 6. Modern UI System
Animated and immersive developer-style interface.

---

## 🚧 Future Scope

### AI Debugger (Auto-Fix Engine)
One-click debugging:

- captures runtime errors
- sends code to AI
- returns corrected version
- diff viewer for learning

### Gamified Social System
- streak tracking
- activity reinforcement
- leaderboards
- course competition

### Advanced Sandbox v2
- video resume memory
- resizable panes
- IDE-like workspace

### Study Buddy System
Peer matching for collaborative learning.

### Project Builder Ecosystem
4-layer system:

1. Idea board
2. AI scaffolding generator
3. contribution approval system
4. progress feed

### VS Code Extension
Local IDE integration with AI assistant.

### Company Training Portal
Enterprise dashboard for internal learning systems.

---

## 🧠 Technical Themes

- AI-assisted education
- sandboxed code execution
- collaborative development systems
- gamification psychology
- scalable MERN architecture
- IDE ecosystem integration
- community-driven learning

---

## 💻 Tech Stack

| Category | Technology |
|---------|------------|
| Frontend | React, JavaScript, CSS3, Monaco Editor |
| Backend | Node.js, Express |
| Database | MongoDB |
| AI | Google Gemini API |
| Authentication | JWT + Bcrypt |
| Execution Engine | Python sandbox execution |
| APIs | YouTube Data API |

---

## 🛠️ Setup & Installation

### Prerequisites

- Node.js (v14+)
- npm
- Git
- MongoDB Atlas account
- Google Gemini API key
- YouTube Data API key

---

### 1. Clone Repository

```bash
git clone https://github.com/TanishkOjha24/CodeWithMee002.git
cd CodeWithMee002
```

---

### 2. Install Dependencies

```bash
cd server
npm install

cd ../client
npm install
```

---

### 3. Environment Variables

Create `.env` inside `/server`:

```
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
GEMINI_API_KEY=your_google_api_key
YOUTUBE_API_KEY=your_youtube_api_key
```

⚠️ Never commit `.env` to Git.

---

### 4. Run Application

Start backend:

```bash
cd server
npm start
```

Start frontend:

```bash
cd client
npm start
```

Server → http://localhost:5001  
Client → http://localhost:3000

---

## 🎯 Vision

CodeWithMee aims to become:

> An AI-powered learning operating system that merges education, collaboration, and real-world development into one unified ecosystem.

Users don’t just learn — they build, collaborate, and grow inside a guided AI environment.

---

## 👨‍💻 Authors

Developed as an academic and experimental AI learning platform project by Arnav Murdande & Tanishk Ojha

---

## ⭐ Support

If you like the project, consider starring the repository!

