// index.js — COMPLETE BACKEND (Admin + Students + Test History + Delete Test)

const express = require("express");
const cors = require("cors");
const knex = require("knex");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

// SECRET (for JWT)
const SECRET = "MY_SECRET_CHANGE_ME";

// --------------------------------------------
// DATABASE INIT
// --------------------------------------------
const db = knex({
  client: "sqlite3",
  connection: {
    filename: "./quiz.db",
  },
  useNullAsDefault: true,
});

// --------------------------------------------
// CREATE TABLES
// --------------------------------------------
async function initDb() {
  // Admins
  const hasAdmins = await db.schema.hasTable("admins");
  if (!hasAdmins) {
    await db.schema.createTable("admins", (t) => {
      t.increments("id").primary();
      t.string("email").unique();
      t.string("password_hash");
    });

    const hash = await bcrypt.hash("1234", 10);
    await db("admins").insert({
      email: "admin@test.com",
      password_hash: hash,
    });
  }

  // Students
  const hasStudents = await db.schema.hasTable("students");
  if (!hasStudents) {
    await db.schema.createTable("students", (t) => {
      t.increments("id").primary();
      t.string("name");
      t.string("email").unique();
      t.string("password_hash");
    });
  }

  // Tests
  const hasTests = await db.schema.hasTable("tests");
  if (!hasTests) {
    await db.schema.createTable("tests", (t) => {
      t.increments("id").primary();
      t.string("title");
    });
  }

  // Questions
  const hasQuestions = await db.schema.hasTable("questions");
  if (!hasQuestions) {
    await db.schema.createTable("questions", (t) => {
      t.increments("id").primary();
      t.integer("test_id");
      t.string("prompt");
    });
  }

  // Choices
  const hasChoices = await db.schema.hasTable("choices");
  if (!hasChoices) {
    await db.schema.createTable("choices", (t) => {
      t.increments("id").primary();
      t.integer("question_id");
      t.string("text");
      t.boolean("is_correct");
    });
  }

  // Attempts history
  const hasAttempts = await db.schema.hasTable("attempts");
  if (!hasAttempts) {
    await db.schema.createTable("attempts", (t) => {
      t.increments("id").primary();
      t.integer("student_id");
      t.integer("test_id");
      t.integer("score");
      t.timestamp("created_at").defaultTo(db.fn.now());
    });
  }
}

initDb();

// --------------------------------------------
// AUTH MIDDLEWARE
// --------------------------------------------
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ ok: false, error: "Missing token" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SECRET);
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

// --------------------------------------------
// ADMIN ROUTES
// --------------------------------------------

// Admin Login
app.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;

  const admin = await db("admins").where({ email }).first();
  if (!admin) return res.json({ ok: false });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.json({ ok: false });

  const token = jwt.sign({ adminId: admin.id, email }, SECRET, {
    expiresIn: "6h",
  });

  res.json({ ok: true, token });
});

// Admin Create Test
app.post("/admin/create-sample-test", requireAdmin, async (req, res) => {
  const { title } = req.body;
  const [testId] = await db("tests").insert({ title });
  res.json({ ok: true, testId });
});

// Add Question
app.post("/admin/tests/:id/add-question", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { prompt, choices, correctIndex } = req.body;

  const [qId] = await db("questions").insert({
    test_id: id,
    prompt,
  });

  for (let i = 0; i < choices.length; i++) {
    await db("choices").insert({
      question_id: qId,
      text: choices[i],
      is_correct: i === correctIndex,
    });
  }

  res.json({ ok: true });
});

// DELETE TEST (Step 14)
app.delete("/admin/delete-test/:id", requireAdmin, async (req, res) => {
  const testId = req.params.id;

  const questions = await db("questions").where({ test_id: testId });

  for (let q of questions) {
    await db("choices").where({ question_id: q.id }).del();
  }

  await db("questions").where({ test_id: testId }).del();
  await db("attempts").where({ test_id: testId }).del();
  await db("tests").where({ id: testId }).del();

  res.json({ ok: true });
});

// DELETE ONE QUESTION (Step 15)
app.delete("/admin/delete-question/:id", requireAdmin, async (req, res) => {
  const questionId = req.params.id;

  // delete choices first
  await db("choices").where({ question_id: questionId }).del();

  // delete the question
  await db("questions").where({ id: questionId }).del();

  res.json({ ok: true });
});

// --------------------------------------------
// STUDENT ROUTES
// --------------------------------------------

// Student Register
app.post("/student/register", async (req, res) => {
  const { name, email, password } = req.body;

  const exists = await db("students").where({ email }).first();
  if (exists) return res.json({ ok: false, error: "Email already exists" });

  const hash = await bcrypt.hash(password, 10);

  const [id] = await db("students").insert({
    name,
    email,
    password_hash: hash,
  });

  res.json({ ok: true, studentId: id });
});

// Student Login
app.post("/student/login", async (req, res) => {
  const { email, password } = req.body;

  const student = await db("students").where({ email }).first();
  if (!student) return res.json({ ok: false });

  const valid = await bcrypt.compare(password, student.password_hash);
  if (!valid) return res.json({ ok: false });

  const token = jwt.sign(
    {
      studentId: student.id,
      name: student.name,
      email: student.email,
    },
    SECRET,
    { expiresIn: "6h" }
  );

  res.json({
    ok: true,
    token,
    student: {
      id: student.id,
      name: student.name,
      email: student.email,
    },
  });
});

// --------------------------------------------
// TEST ROUTES
// --------------------------------------------

// Get All Tests
app.get("/tests", async (req, res) => {
  const tests = await db("tests");
  res.json(tests);
});

// Get Test + Questions + Choices
app.get("/tests/:id", async (req, res) => {
  const { id } = req.params;

  const test = await db("tests").where({ id }).first();
  const questions = await db("questions").where({ test_id: id });

  for (let q of questions) {
    q.choices = await db("choices").where({ question_id: q.id });
  }

  res.json({ test, questions });
});

// Submit Test
app.post("/tests/:id/submit", async (req, res) => {
  const { answers, studentId } = req.body;

  let score = 0;

  for (let a of answers) {
    const choice = await db("choices").where({ id: a.choice_id }).first();
    if (choice && choice.is_correct) score++;
  }

  await db("attempts").insert({
    student_id: studentId,
    test_id: req.params.id,
    score,
  });

  res.json({ score });
});

// Student History
app.get("/student/:id/history", async (req, res) => {
  const id = req.params.id;

  const history = await db("attempts")
    .where({ student_id: id })
    .join("tests", "tests.id", "attempts.test_id")
    .select("tests.title", "attempts.score", "attempts.created_at");

  res.json({ ok: true, history });
});

// --------------------------------------------
// START SERVER
// --------------------------------------------
app.listen(4000, () => console.log("Backend running on http://localhost:4000"));
