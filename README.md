# CodeWithMee 🚀

Welcome to CodeWithMee, an interactive, AI-powered learning environment designed to make coding an adventure. This platform generates personalized learning roadmaps and provides a split-screen sandbox where you can watch video tutorials and code simultaneously, all with the help of a personal AI assistant.



<img width="1024" height="1024" alt="Gemini_Generated_Image_7hy9217hy9217hy9" src="https://github.com/user-attachments/assets/1473a345-04bc-449a-a0b2-98d4bd0e94ca" />





---

## ✨ Key Features

* **🤖 AI-Powered Roadmap Generation**: Enter a programming language and your skill level (Beginner, Intermediate, Advanced), and our AI will generate a complete, step-by-step learning path for you.
* **📚 Interactive Learning Sandbox**: Each topic in your roadmap links to a split-screen view featuring:
    * A **dynamically fetched YouTube tutorial** relevant to the topic.
    * A live **code editor** with Python syntax highlighting.
    * An **output console** to see the results of your code instantly.
* **🧠 Personal AI Assistant ("Mee")**: Stuck on a problem? Ask Mee a question about your code directly within the sandbox, and get instant, helpful answers.
* **🔐 Full User Authentication**: Secure user registration and login system using JWT (JSON Web Tokens) to save and track progress.
* **🎨 Stunning Frontend**: A modern, responsive, and visually appealing user interface with custom animations and a unique theme.

---

## 💻 Tech Stack

This project is a full-stack application built with the MERN stack and integrated with powerful external APIs.

| Category   | Technology                                                                                                                              |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend** | ![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black) ![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white) |
| **Backend** | ![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white) ![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)                               |
| **Database** | ![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)                                   |
| **APIs** | ![Google Gemini](https://img.shields.io/badge/Google_Gemini-8E75B7?style=for-the-badge) ![YouTube](https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white)          |

---

## 🛠️ Setup and Installation

Follow these steps to get the project running on your local machine.

### Prerequisites

* [Node.js](https://nodejs.org/) (v14 or later)
* [npm](https://www.npmjs.com/)
* [Git](https://git-scm.com/)
* A free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) account
* A [Google AI API Key](https://aistudio.google.com/) for Gemini
* A [YouTube Data API v3 Key](https://console.cloud.google.com/apis/library/youtube.googleapis.com)

1.  **Clone the Repository**

    Clone the project to your local machine:
    ```bash
    git clone [https://github.com/TanishkOjha24/CodeWithMee002.git](https://github.com/TanishkOjha24/CodeWithMee002.git)
    cd CodeWithMee002
    ```

2.  **Install Dependencies**

    You'll need to install dependencies for both the `server` and the `client`.

    ```bash
    # Install server dependencies
    cd server
    npm install

    # Install client dependencies
    cd ../client
    npm install
    ```

3.  **Set Up Environment Variables**

    The backend requires secret keys to connect to the database and external APIs.

    1.  Navigate to the `server` directory.
    2.  Create a new file named `.env`.
    3.  Add the following variables to your `.env` file, replacing the placeholder values with your actual keys:

        ```
        MONGO_URI=your_mongodb_connection_string
        JWT_SECRET=a_long_and_random_secret_string_for_jwt
        GEMINI_API_KEY=your_google_ai_api_key
        YOUTUBE_API_KEY=your_youtube_data_api_key
        ```

        **Note:** It is crucial that these keys are kept private and that the `.env` file is never committed to Git.

4.  **Run the Application**

    You need to start both the backend server and the frontend client in separate terminals.

    * **To start the server:**
        ```bash
        cd server
        npm start
        ```
        The server will be running on `http://localhost:5001`.

    * **To start the client:**
        ```bash
        cd client
        npm start
        ```
        The React application will open in your browser at `http://localhost:3000`.

---

