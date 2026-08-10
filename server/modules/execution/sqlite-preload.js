'use strict';

const SQLITE_PRELOAD = `
-- Pre-loaded sample database tables: students, courses, enrollments, users, products, orders
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER,
    grade TEXT,
    gpa REAL
);

CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    credits INTEGER,
    department TEXT
);

CREATE TABLE IF NOT EXISTS enrollments (
    student_id INTEGER,
    course_id INTEGER,
    semester TEXT,
    FOREIGN KEY(student_id) REFERENCES students(id),
    FOREIGN KEY(course_id) REFERENCES courses(id)
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    category TEXT,
    stock INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    product_id INTEGER,
    quantity INTEGER DEFAULT 1,
    total_price DECIMAL(10, 2),
    order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
);

INSERT OR IGNORE INTO students (id, name, age, grade, gpa) VALUES
(1, 'Alex Rivers', 20, 'Junior', 3.8),
(2, 'Jordan Lee', 19, 'Sophomore', 3.4),
(3, 'Taylor Swift', 21, 'Senior', 3.9),
(4, 'Morgan Vance', 18, 'Freshman', 2.9);

INSERT OR IGNORE INTO courses (id, name, credits, department) VALUES
(101, 'Intro to Computer Science', 4, 'CS'),
(102, 'Data Structures & Algorithms', 4, 'CS'),
(201, 'Calculus I', 3, 'Math');

INSERT OR IGNORE INTO enrollments (student_id, course_id, semester) VALUES
(1, 101, 'Fall 2024'),
(1, 102, 'Spring 2025'),
(2, 101, 'Fall 2024'),
(3, 201, 'Fall 2024');

INSERT OR IGNORE INTO users (id, name, email, role) VALUES
(1, 'Alice Johnson', 'alice@example.com', 'admin'),
(2, 'Bob Smith', 'bob@example.com', 'user'),
(3, 'Charlie Brown', 'charlie@example.com', 'user');

INSERT OR IGNORE INTO products (id, name, price, category, stock) VALUES
(101, 'Laptop', 999.99, 'Electronics', 15),
(102, 'Wireless Mouse', 24.99, 'Electronics', 50),
(103, 'Coffee Mug', 12.50, 'Kitchenware', 100);

INSERT OR IGNORE INTO orders (id, user_id, product_id, quantity, total_price) VALUES
(1, 1, 101, 1, 999.99),
(2, 2, 102, 2, 49.98),
(3, 3, 103, 4, 50.00);

.mode column
.headers on
`;

function sanitizeStderr(stderr) {
  if (!stderr) return '';
  const lines = stderr.split('\n').filter((line) => {
    if (/WARNING: Duplicate name in Manifest: Main-Class/i.test(line)) return false;
    if (/java\.util\.jar\.Attributes read/i.test(line)) return false;
    if (/Ensure that the manifest does not have duplicate entries/i.test(line)) return false;
    if (/that blank lines separate individual sections in both your/i.test(line)) return false;
    if (/manifest and in the META-INF\/MANIFEST\.MF entry in the jar file/i.test(line)) return false;
    return true;
  });
  return lines.join('\n').trim();
}

module.exports = { SQLITE_PRELOAD, sanitizeStderr };
