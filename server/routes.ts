import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import multer from "multer";
import path from "path";
import fs from "fs";
import OpenAI from "openai";
import { storage, seedDatabase } from "./storage";
import { loginSchema, insertClassSchema } from "@shared/schema";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const uploadDir = path.join(process.cwd(), "uploads", "pdfs");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
      cb(null, unique + path.extname(file.originalname));
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

const submissionDir = path.join(process.cwd(), "uploads", "submissions");
if (!fs.existsSync(submissionDir)) fs.mkdirSync(submissionDir, { recursive: true });

const submissionUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, submissionDir),
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
      cb(null, unique + path.extname(file.originalname));
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PDF and Word (.docx) documents are allowed"));
  },
  limits: { fileSize: 25 * 1024 * 1024 },
});

const PgSession = connectPgSimple(session);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function requireAuth(req: Request, res: Response, next: Function) {
  if (!(req.session as any).userId) return res.status(401).json({ message: "Unauthorized" });
  next();
}

function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: Function) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(userId);
    if (!user || !roles.includes(user.role)) return res.status(403).json({ message: "Forbidden" });
    (req as any).user = user;
    next();
  };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const sessionMiddleware = session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "edusense-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  });
  app.use(sessionMiddleware);

  const { setupSocketIO } = await import("./socket");
  setupSocketIO(httpServer, sessionMiddleware);

  await seedDatabase();

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      const user = await storage.getUserByUsername(username);
      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      (req.session as any).userId = user.id;
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (err) {
      res.status(400).json({ message: "Invalid request" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  // Classes
  app.get("/api/classes", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    if (user.role === "teacher") {
      const classList = await storage.getClasses(user.id);
      const withStudentCount = await Promise.all(classList.map(async cls => {
        const students = await storage.getClassStudents(cls.id);
        return { ...cls, studentCount: students.length };
      }));
      res.json(withStudentCount);
    } else if (user.role === "student") {
      const classList = await storage.getStudentClasses(user.id);
      res.json(classList);
    } else {
      const classList = await storage.getAllClasses();
      res.json(classList);
    }
  });

  app.post("/api/classes", requireRole("teacher", "admin"), async (req, res) => {
    try {
      const user = (req as any).user;
      const data = insertClassSchema.parse(req.body);
      const joinCode = generateJoinCode();
      const cls = await storage.createClass({ ...data, teacherId: user.id, joinCode });
      res.json(cls);
    } catch (err) {
      res.status(400).json({ message: "Invalid class data" });
    }
  });

  app.get("/api/classes/:id", requireAuth, async (req, res) => {
    const cls = await storage.getClass(req.params.id);
    if (!cls) return res.status(404).json({ message: "Class not found" });
    const students = await storage.getClassStudents(cls.id);
    const sessions = await storage.getSessions(cls.id);
    const assignments = await storage.getAssignments(cls.id);
    res.json({ ...cls, students, sessions, assignments });
  });

  app.delete("/api/classes/:id", requireRole("teacher", "admin"), async (req, res) => {
    const user = (req as any).user;
    if (user.role === "teacher") {
      const cls = await storage.getClass(req.params.id);
      if (!cls || cls.teacherId !== user.id) return res.status(403).json({ message: "You can only delete your own classes" });
    }
    await storage.deleteClass(req.params.id);
    res.json({ ok: true });
  });

  // Enroll
  app.post("/api/classes/join", requireAuth, async (req, res) => {
    const { joinCode } = req.body;
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const cls = await storage.getClassByJoinCode(joinCode);
    if (!cls) return res.status(404).json({ message: "Class not found with that code" });
    const already = await storage.isEnrolled(cls.id, user.id);
    if (already) return res.status(400).json({ message: "Already enrolled" });
    await storage.enrollStudent(cls.id, user.id);
    await storage.createNotification({
      userId: user.id,
      type: "enrolled",
      title: "Class Joined",
      body: `You have successfully joined ${cls.title}`,
    });
    res.json(cls);
  });

  app.get("/api/classes/:id/students", requireAuth, async (req, res) => {
    const students = await storage.getClassStudents(req.params.id);
    const safeStudents = students.map(({ password: _, ...s }) => s);
    res.json(safeStudents);
  });

  app.delete("/api/classes/:classId/students/:studentId", requireRole("teacher", "admin"), async (req, res) => {
    await storage.unenrollStudent(req.params.classId, req.params.studentId);
    res.json({ ok: true });
  });

  // Sessions
  app.get("/api/sessions/student/live", requireRole("student"), async (req, res) => {
    const user = (req as any).user;
    const liveSessions = await storage.getStudentLiveSessions(user.id);
    res.json(liveSessions);
  });

  app.get("/api/sessions", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const sessions = await storage.getTeacherSessions(user.id);
    res.json(sessions);
  });

  app.post("/api/sessions", requireRole("teacher"), async (req, res) => {
    const user = (req as any).user;
    const { classId, title } = req.body;
    const session_ = await storage.createSession({ classId, teacherId: user.id, title });
    const students = await storage.getClassStudents(classId);
    for (const student of students) {
      await storage.createNotification({
        userId: student.id,
        type: "class_starting",
        title: "Class Starting Now!",
        body: `${title || "A live session"} has started. Join now!`,
      });
    }
    res.json(session_);
  });

  app.get("/api/sessions/:id", requireAuth, async (req, res) => {
    const session_ = await storage.getSession(req.params.id);
    if (!session_) return res.status(404).json({ message: "Session not found" });
    const scores = await storage.getSessionScores(session_.id);
    res.json({ ...session_, scores });
  });

  app.put("/api/sessions/:id", requireRole("teacher"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.endedAt) data.endedAt = new Date(data.endedAt);
      const session_ = await storage.updateSession(req.params.id, data);
      res.json(session_);
    } catch (error) {
      console.error("Failed to update session:", error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  app.post("/api/sessions/:id/scores", requireAuth, async (req, res) => {
    const { studentId, score, emotion } = req.body;
    const scoreRecord = await storage.addAttentionScore({ sessionId: req.params.id, studentId, score, emotion });
    res.json(scoreRecord);
  });

  // Books
  app.get("/api/books", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const bookList = await storage.getBooks(user.role === "teacher" ? user.id : undefined);
    res.json(bookList);
  });

  app.post("/api/books", requireRole("teacher", "admin"), pdfUpload.single("pdf"), async (req, res) => {
    const user = (req as any).user;
    const { title, subject, totalPages, tags, coverColor } = req.body;
    let parsedTags: string[] = [];
    try { parsedTags = tags ? (typeof tags === "string" ? JSON.parse(tags) : tags) : []; } catch { parsedTags = []; }
    const pdfPath = req.file ? req.file.filename : null;
    const book = await storage.createBook({
      title,
      uploadedBy: user.id,
      subject,
      totalPages: parseInt(totalPages) || 1,
      tags: parsedTags,
      coverColor,
      pdfPath,
    });
    res.json(book);
  });

  app.get("/api/books/:id/pdf", requireAuth, async (req, res) => {
    const book = await storage.getBook(req.params.id);
    if (!book || !book.pdfPath) return res.status(404).json({ message: "PDF not found" });
    const filePath = path.join(uploadDir, book.pdfPath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "PDF file missing" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${book.title}.pdf"`);
    fs.createReadStream(filePath).pipe(res);
  });

  app.delete("/api/books/:id", requireRole("teacher", "admin"), async (req, res) => {
    const book = await storage.getBook(req.params.id);
    if (book?.pdfPath) {
      const filePath = path.join(uploadDir, book.pdfPath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await storage.deleteBook(req.params.id);
    res.json({ ok: true });
  });

  // Assignments
  app.get("/api/assignments", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    if (user.role === "student") {
      const studentAssignments = await storage.getStudentAssignments(user.id);
      res.json(studentAssignments);
    } else {
      const { classId } = req.query;
      if (classId) {
        if (user.role === "teacher") {
          const cls = await storage.getClass(classId as string);
          if (!cls || cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
        }
        const classAssignments = await storage.getAssignments(classId as string);
        const withBooks = await Promise.all(classAssignments.map(async (a) => {
          const book = await storage.getBook(a.bookId);
          return { ...a, book };
        }));
        res.json(withBooks);
      } else {
        res.json([]);
      }
    }
  });

  app.post("/api/assignments", requireRole("teacher", "admin"), async (req, res) => {
    const { bookId, classId, dueAt, timerSeconds, allowSkip } = req.body;
    const assignment = await storage.createAssignment({
      bookId, classId,
      dueAt: dueAt ? new Date(dueAt) : undefined,
      timerSeconds: timerSeconds ? parseInt(timerSeconds) : undefined,
      allowSkip: allowSkip !== false,
    });
    res.json(assignment);
  });

  // Notifications
  app.get("/api/notifications", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const notifs = await storage.getNotifications(userId);
    res.json(notifs);
  });

  app.put("/api/notifications/:id/read", requireAuth, async (req, res) => {
    await storage.markNotificationRead(req.params.id);
    res.json({ ok: true });
  });

  app.put("/api/notifications/read-all", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    await storage.markAllNotificationsRead(userId);
    res.json({ ok: true });
  });

  // Badges
  app.get("/api/badges", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const userBadges = await storage.getBadges(userId);
    res.json(userBadges);
  });

  app.get("/api/badges/:userId", requireAuth, async (req, res) => {
    const userBadges = await storage.getBadges(req.params.userId);
    res.json(userBadges);
  });

  // Analytics
  app.get("/api/analytics/class/:classId", requireRole("teacher", "admin"), async (req, res) => {
    const analytics = await storage.getClassAnalytics(req.params.classId);
    const sessions = await storage.getSessions(req.params.classId);
    res.json({ ...analytics, sessions });
  });

  app.get("/api/analytics/student/:studentId", requireAuth, async (req, res) => {
    const analytics = await storage.getStudentAnalytics(req.params.studentId);
    const badges = await storage.getBadges(req.params.studentId);
    res.json({ ...analytics, badges });
  });

  // Parent Reports
  app.get("/api/reports/student/:studentId/class/:classId", requireRole("teacher", "admin"), async (req, res) => {
    const user = (req as any).user;
    const cls = await storage.getClass(req.params.classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });
    if (user.role === "teacher" && cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
    const enrolled = await storage.isEnrolled(req.params.classId, req.params.studentId);
    if (!enrolled) return res.status(404).json({ message: "Student not enrolled in this class" });
    const data = await storage.getStudentReportData(req.params.studentId, req.params.classId);
    if (!data) return res.status(404).json({ message: "Student not found" });
    res.json({ ...data, className: cls.title || "Unknown Class" });
  });

  app.get("/api/reports/student/:studentId/class/:classId/pdf", requireRole("teacher", "admin"), async (req, res) => {
    const user = (req as any).user;
    const cls = await storage.getClass(req.params.classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });
    if (user.role === "teacher" && cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
    const enrolled = await storage.isEnrolled(req.params.classId, req.params.studentId);
    if (!enrolled) return res.status(404).json({ message: "Student not enrolled in this class" });
    const data = await storage.getStudentReportData(req.params.studentId, req.params.classId);
    if (!data) return res.status(404).json({ message: "Student not found" });
    const className = cls.title || "Unknown Class";

    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Report_${data.student.name.replace(/\s/g, "_")}.pdf"`);
    doc.pipe(res);

    const navy = "#1E3A5F";
    const blue = "#2563EB";
    const gray = "#64748B";

    doc.rect(0, 0, doc.page.width, 120).fill(navy);
    doc.fontSize(28).fillColor("#FFFFFF").text("EduSense AI", 50, 35);
    doc.fontSize(12).fillColor("#94A3B8").text("Student Progress Report", 50, 70);
    doc.fontSize(10).fillColor("#94A3B8").text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 50, 90);

    let y = 145;
    doc.fontSize(20).fillColor(navy).text(data.student.name, 50, y);
    y += 30;
    doc.fontSize(11).fillColor(gray).text(`Class: ${className}`, 50, y);
    doc.text(`Level ${data.level}  •  ${data.xp} XP  •  ${data.streakDays}-day streak`, 300, y);
    y += 35;

    doc.rect(50, y, doc.page.width - 100, 1).fill("#E2E8F0");
    y += 15;

    doc.fontSize(14).fillColor(navy).text("Attendance & Engagement", 50, y);
    y += 25;

    const drawStatBox = (x: number, yPos: number, label: string, value: string, color: string) => {
      doc.rect(x, yPos, 120, 65).lineWidth(1).strokeColor("#E2E8F0").stroke();
      doc.fontSize(22).fillColor(color).text(value, x + 10, yPos + 12, { width: 100, align: "center" });
      doc.fontSize(8).fillColor(gray).text(label, x + 10, yPos + 42, { width: 100, align: "center" });
    };

    drawStatBox(50, y, "Sessions Attended", `${data.sessionsAttended}/${data.sessionsTotal}`, blue);
    drawStatBox(185, y, "Avg Attention", `${data.avgAttention}%`, data.avgAttention >= 70 ? "#16A34A" : data.avgAttention >= 50 ? "#EAB308" : "#DC2626");
    drawStatBox(320, y, "Books Completed", `${data.readingCompleted}`, blue);
    drawStatBox(455, y, "Total XP", `${data.xp}`, "#7C3AED");
    y += 85;

    if (data.quizAttempts.length > 0) {
      doc.rect(50, y, doc.page.width - 100, 1).fill("#E2E8F0");
      y += 15;
      doc.fontSize(14).fillColor(navy).text("Quiz Performance", 50, y);
      y += 25;

      doc.fontSize(9).fillColor(gray);
      doc.text("Quiz", 50, y, { width: 200 });
      doc.text("Score", 300, y, { width: 80 });
      doc.text("Date", 400, y, { width: 120 });
      y += 18;
      doc.rect(50, y - 3, doc.page.width - 100, 0.5).fill("#E2E8F0");
      y += 5;

      for (const attempt of data.quizAttempts.slice(0, 10)) {
        const quizTitle = (attempt as any).quiz?.title || "Quiz";
        const date = attempt.completedAt ? new Date(attempt.completedAt).toLocaleDateString() : "N/A";
        doc.fontSize(10).fillColor("#1E293B");
        doc.text(quizTitle, 50, y, { width: 240 });
        const scoreColor = (attempt.score || 0) >= 80 ? "#16A34A" : (attempt.score || 0) >= 60 ? "#EAB308" : "#DC2626";
        doc.fillColor(scoreColor).text(`${attempt.score || 0}%`, 300, y, { width: 80 });
        doc.fillColor(gray).text(date, 400, y, { width: 120 });
        y += 20;
        if (y > 700) { doc.addPage(); y = 50; }
      }
      y += 10;
    }

    if (data.badges.length > 0) {
      if (y > 650) { doc.addPage(); y = 50; }
      doc.rect(50, y, doc.page.width - 100, 1).fill("#E2E8F0");
      y += 15;
      doc.fontSize(14).fillColor(navy).text("Badges & Achievements", 50, y);
      y += 25;

      const badgesPerRow = 3;
      for (let i = 0; i < Math.min(data.badges.length, 12); i++) {
        const badge = data.badges[i];
        const col = i % badgesPerRow;
        const row = Math.floor(i / badgesPerRow);
        const bx = 50 + col * 170;
        const by = y + row * 35;
        doc.rect(bx, by, 155, 28).lineWidth(0.5).strokeColor("#E2E8F0").fillAndStroke("#F8FAFC", "#E2E8F0");
        doc.fontSize(9).fillColor(navy).text(`🏆 ${badge.label}`, bx + 8, by + 8, { width: 140 });
        if (by > 700) { doc.addPage(); y = 50; }
      }
      y += Math.ceil(Math.min(data.badges.length, 12) / badgesPerRow) * 35 + 15;
    }

    if (y > 700) { doc.addPage(); y = 50; }
    doc.rect(50, y, doc.page.width - 100, 1).fill("#E2E8F0");
    y += 15;
    doc.fontSize(14).fillColor(navy).text("Summary", 50, y);
    y += 22;

    const attendanceRate = data.sessionsTotal > 0 ? Math.round((data.sessionsAttended / data.sessionsTotal) * 100) : 0;
    const avgQuizScore = data.quizAttempts.length > 0
      ? Math.round(data.quizAttempts.reduce((s, a) => s + (a.score || 0), 0) / data.quizAttempts.length)
      : 0;

    doc.fontSize(10).fillColor("#1E293B");
    doc.text(`${data.student.name} has attended ${attendanceRate}% of class sessions with an average attention score of ${data.avgAttention}%.`, 50, y, { width: doc.page.width - 100 });
    y += 20;
    if (data.quizAttempts.length > 0) {
      doc.text(`Quiz performance averages ${avgQuizScore}% across ${data.quizAttempts.length} quiz${data.quizAttempts.length > 1 ? "zes" : ""}.`, 50, y, { width: doc.page.width - 100 });
      y += 20;
    }
    doc.text(`${data.badges.length} badge${data.badges.length !== 1 ? "s" : ""} earned. Current streak: ${data.streakDays} day${data.streakDays !== 1 ? "s" : ""}.`, 50, y, { width: doc.page.width - 100 });
    y += 30;

    doc.fontSize(8).fillColor("#94A3B8").text("This report was auto-generated by EduSense AI. For questions, contact your instructor.", 50, y, { width: doc.page.width - 100, align: "center" });

    doc.end();
  });

  // Leaderboard
  app.get("/api/leaderboard/:classId", requireAuth, async (req, res) => {
    const leaderboard = await storage.getLeaderboard(req.params.classId);
    const safe = leaderboard.map(entry => ({ ...entry, user: { ...entry.user, password: undefined } }));
    res.json(safe);
  });

  // AI Doubt Solver
  const doubtSolverSchema = z.object({
    question: z.string().min(1).max(1000),
    bookTitle: z.string().max(200).optional(),
    bookSubject: z.string().max(100).optional(),
    pageContent: z.string().max(5000).optional(),
    chatHistory: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(2000),
    })).max(20).optional(),
  });

  app.post("/api/doubt-solver", requireAuth, async (req, res) => {
    const parsed = doubtSolverSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
    const { question, bookTitle, bookSubject, pageContent, chatHistory } = parsed.data;

    const systemPrompt = `You are EduSense AI Doubt Solver, a friendly and knowledgeable educational assistant. You help students understand what they are reading.

${bookTitle ? `The student is currently reading "${bookTitle}"${bookSubject ? ` (Subject: ${bookSubject})` : ""}.` : ""}
${pageContent ? `\nThe current page content is:\n---\n${pageContent}\n---\n` : ""}

Guidelines:
- Give clear, concise explanations appropriate for a student
- Use examples and analogies to explain difficult concepts
- If the question is about the page content, reference specific parts
- Encourage the student and build their confidence
- Keep answers focused and not too long (2-4 paragraphs max)
- If you don't know something specific about the book, explain the concept generally

Formatting rules (VERY IMPORTANT):
- NEVER use LaTeX notation like \\( \\), \\[ \\], \\frac{}{}, \\int, \\sum etc.
- For math formulas, use plain Unicode symbols and clear text notation:
  • Fractions: write "d/dx" or "(a + b) / c" not \\frac{a+b}{c}
  • Exponents: write "x²", "x³", "xⁿ" using superscript Unicode
  • Subscripts: write "x₁", "x₂" using subscript Unicode
  • Common symbols: use ×, ÷, ±, √, ∫, ∑, ∞, π, θ, Δ, ≤, ≥, ≠, →, ∈
  • Derivatives: write "f'(x)" or "dy/dx" or "d²y/dx²"
  • Greek letters: spell out or use Unicode (α, β, γ, δ, ε, λ, μ, σ, φ, ω)
- Use **bold** for key terms and emphasis
- Use bullet points (•) for lists
- Use line breaks between paragraphs for readability
- For step-by-step solutions, number each step clearly`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: question });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let aborted = false;
    req.on("close", () => { aborted = true; });

    try {
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        stream: true,
        max_tokens: 1024,
      });

      for await (const chunk of stream) {
        if (aborted) break;
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
      if (!aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    } catch (error: any) {
      console.error("Doubt solver error:", error);
      if (!aborted) {
        if (res.headersSent) {
          res.write(`data: ${JSON.stringify({ error: "AI service temporarily unavailable" })}\n\n`);
          res.end();
        } else {
          res.status(500).json({ message: "AI service error" });
        }
      }
    }
  });

  // AI Advisor for Teachers
  const advisorSchema = z.object({
    question: z.string().min(1).max(1500),
    chatHistory: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(3000),
    })).max(20).optional(),
  });

  app.post("/api/ai-advisor", requireRole("teacher", "admin"), async (req, res) => {
    const parsed = advisorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
    const { question, chatHistory } = parsed.data;
    const user = (req as any).user;

    const overview = await storage.getTeacherOverviewForAI(user.id);

    const systemPrompt = `You are EduSense AI Advisor, an expert educational consultant for teachers. You have access to real data from this teacher's classes and students.

Teacher: ${user.name}
Total Classes: ${overview.totalClasses}
Total Students: ${overview.totalStudents}
Total Sessions Conducted: ${overview.totalSessions}

Class-by-class data:
${overview.classes.map(c => `
📚 ${c.className} (${c.subject})
  • Students: ${c.studentCount}
  • Sessions: ${c.sessionCount}
  • Average Attention: ${c.avgAttention}%
  • Boredom Events: ${c.boredCount}
  • Top Performers: ${c.topStudents.join(", ") || "None yet"}
  • Students Needing Support (low XP): ${c.lowXpStudents.join(", ") || "None"}
  • Student Details: ${c.students.map(s => `${s.name} (Lvl ${s.level}, ${s.xp} XP, ${s.streakDays}-day streak${s.learningStyle ? `, ${s.learningStyle} learner` : ""})`).join("; ")}
`).join("\n")}

Your role:
- Provide actionable, data-driven advice based on the real class data above
- Identify students who need attention, are falling behind, or excelling
- Suggest teaching strategies to improve attention scores and reduce boredom
- Recommend ways to boost engagement, XP participation, and streak consistency
- Offer personalized suggestions per class or per student when asked
- Be supportive and professional — you're a trusted advisor, not a critic

Formatting rules:
- Use **bold** for key terms, student names, and important numbers
- Use bullet points (•) for lists
- Use numbered steps for action plans
- Keep advice practical and specific (reference actual student names and class data)
- Use line breaks between sections for readability
- NEVER use LaTeX notation`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (chatHistory && Array.isArray(chatHistory)) {
      for (const msg of chatHistory.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: "user", content: question });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let aborted = false;
    req.on("close", () => { aborted = true; });

    try {
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        stream: true,
        max_tokens: 1500,
      });

      for await (const chunk of stream) {
        if (aborted) break;
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
      if (!aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    } catch (error: any) {
      console.error("AI Advisor error:", error);
      if (!aborted) {
        if (res.headersSent) {
          res.write(`data: ${JSON.stringify({ error: "AI service temporarily unavailable" })}\n\n`);
          res.end();
        } else {
          res.status(500).json({ message: "AI service error" });
        }
      }
    }
  });

  // Assignment Submissions
  app.post("/api/assignments/:id/submit", requireAuth, submissionUpload.single("file"), async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "student") return res.status(403).json({ message: "Only students can submit" });

      const assignment = await storage.getAssignment(req.params.id);
      if (!assignment) return res.status(404).json({ message: "Assignment not found" });

      const enrolled = await storage.isEnrolled(assignment.classId, userId);
      if (!enrolled) return res.status(403).json({ message: "Not enrolled in this class" });

      const existing = await storage.getStudentSubmission(req.params.id, userId);
      if (existing) return res.status(400).json({ message: "You have already submitted this assignment" });

      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      let extractedText = "";
      try {
        if (req.file.mimetype === "application/pdf") {
          const pdfModule = await import("pdf-parse");
          const PDFParse = pdfModule.PDFParse || pdfModule.default?.PDFParse;
          const dataBuffer = fs.readFileSync(req.file.path);
          const uint8 = new Uint8Array(dataBuffer);
          const parser = new PDFParse(uint8, { verbosity: 0 });
          const pdfData = await parser.getText();
          extractedText = (typeof pdfData === "string" ? pdfData : pdfData?.text || "").substring(0, 50000);
        } else if (req.file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          const mammoth = await import("mammoth");
          const result = await mammoth.extractRawText({ path: req.file.path });
          extractedText = result.value?.substring(0, 50000) || "";
        }
      } catch (err) {
        console.error("Text extraction error:", err);
      }

      const submission = await storage.createSubmission({
        assignmentId: req.params.id,
        studentId: userId,
        fileName: req.file.originalname,
        filePath: req.file.filename,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        extractedText: extractedText || undefined,
      });

      res.json(submission);
    } catch (error: any) {
      console.error("Submission error:", error);
      res.status(500).json({ message: error.message || "Upload failed" });
    }
  });

  app.get("/api/assignments/:id/submissions", requireRole("teacher", "admin"), async (req, res) => {
    const assignment = await storage.getAssignment(req.params.id);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    const user = (req as any).user;
    if (user.role === "teacher") {
      const cls = await storage.getClass(assignment.classId);
      if (!cls || cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
    }
    const subs = await storage.getSubmissionsByAssignment(req.params.id);
    const safe = subs.map(s => ({
      ...s,
      student: s.student ? { ...s.student, password: undefined } : undefined,
      extractedText: undefined,
    }));
    res.json(safe);
  });

  app.get("/api/assignments/:id/my-submission", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const sub = await storage.getStudentSubmission(req.params.id, userId);
    res.json(sub || null);
  });

  app.get("/api/submissions/:id/file", requireAuth, async (req, res) => {
    const sub = await storage.getSubmission(req.params.id);
    if (!sub) return res.status(404).json({ message: "Submission not found" });
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    if (user.role === "student" && sub.studentId !== userId) return res.status(403).json({ message: "Not your submission" });
    if (user.role === "teacher") {
      const assignment = await storage.getAssignment(sub.assignmentId);
      if (assignment) {
        const cls = await storage.getClass(assignment.classId);
        if (!cls || cls.teacherId !== userId) return res.status(403).json({ message: "Not your class" });
      }
    }

    const filePath = path.join(submissionDir, sub.filePath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
    res.setHeader("Content-Type", sub.fileType);
    res.setHeader("Content-Disposition", `inline; filename="${sub.fileName}"`);
    fs.createReadStream(filePath).pipe(res);
  });

  app.post("/api/submissions/:id/grade", requireRole("teacher", "admin"), async (req, res) => {
    const sub = await storage.getSubmission(req.params.id);
    if (!sub) return res.status(404).json({ message: "Submission not found" });
    const user = (req as any).user;

    const assignment = await storage.getAssignment(sub.assignmentId);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    if (user.role === "teacher") {
      const cls = await storage.getClass(assignment.classId);
      if (!cls || cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
    }

    const schema = z.object({ grade: z.number().min(0).max(100), feedback: z.string().max(2000).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid grade data" });

    const updated = await storage.gradeSubmission(req.params.id, parsed.data.grade, parsed.data.feedback);
    res.json(updated);
  });

  app.get("/api/assignments/:id/plagiarism", requireRole("teacher", "admin"), async (req, res) => {
    const assignment = await storage.getAssignment(req.params.id);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    const user = (req as any).user;
    if (user.role === "teacher") {
      const cls = await storage.getClass(assignment.classId);
      if (!cls || cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
    }

    const subs = await storage.getSubmissionsByAssignment(req.params.id);

    for (const sub of subs) {
      if (!sub.extractedText && sub.filePath) {
        try {
          const fullPath = path.join("uploads/submissions", sub.filePath);
          if (fs.existsSync(fullPath)) {
            let text = "";
            if (sub.fileType === "application/pdf") {
              const pdfMod = await import("pdf-parse");
              const PdfCls = pdfMod.PDFParse || pdfMod.default?.PDFParse;
              const buf = new Uint8Array(fs.readFileSync(fullPath));
              const parser = new PdfCls(buf, { verbosity: 0 });
              const pdfData = await parser.getText();
              text = (typeof pdfData === "string" ? pdfData : pdfData?.text || "").substring(0, 50000);
            } else if (sub.fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
              const mammoth = await import("mammoth");
              const result = await mammoth.extractRawText({ path: fullPath });
              text = result.value?.substring(0, 50000) || "";
            }
            if (text.length > 10) {
              await storage.updateSubmissionText(sub.id, text);
              sub.extractedText = text;
            }
          }
        } catch (err) {
          console.error("Backfill text extraction error for", sub.id, err);
        }
      }
    }

    const withText = subs.filter(s => s.extractedText && s.extractedText.length > 50);

    if (withText.length < 2) {
      const book = await storage.getBook(assignment.bookId);
      return res.json({ pairs: [], assignmentTitle: book?.title || "Assignment", totalSubmissions: subs.length });
    }

    function getNGrams(text: string, n: number): Set<string> {
      const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 2);
      const grams = new Set<string>();
      for (let i = 0; i <= words.length - n; i++) {
        grams.add(words.slice(i, i + n).join(" "));
      }
      return grams;
    }

    function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
      let intersection = 0;
      for (const item of a) if (b.has(item)) intersection++;
      const union = a.size + b.size - intersection;
      return union > 0 ? Math.round((intersection / union) * 100) : 0;
    }

    function findMatchingPassages(textA: string, textB: string): { text: string; contextA: string; contextB: string }[] {
      const sentencesA = textA.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 30);
      const sentencesB = textB.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 30);
      const sentencesBLower = new Set(sentencesB.map(s => s.toLowerCase()));
      const matches: { text: string; contextA: string; contextB: string }[] = [];
      for (const s of sentencesA) {
        if (sentencesBLower.has(s.toLowerCase())) {
          const idxA = textA.indexOf(s);
          const idxB = textB.toLowerCase().indexOf(s.toLowerCase());
          const ctxStart = 40;
          const contextA = textA.substring(Math.max(0, idxA - ctxStart), Math.min(textA.length, idxA + s.length + ctxStart));
          const contextB = idxB >= 0 ? textB.substring(Math.max(0, idxB - ctxStart), Math.min(textB.length, idxB + s.length + ctxStart)) : s;
          matches.push({ text: s.substring(0, 300), contextA: contextA.substring(0, 400), contextB: contextB.substring(0, 400) });
          if (matches.length >= 8) break;
        }
      }
      if (matches.length === 0) {
        const wordsA = textA.toLowerCase().split(/\s+/);
        const wordsB = new Set(textB.toLowerCase().split(/\s+/));
        const windowSize = 12;
        for (let i = 0; i <= wordsA.length - windowSize && matches.length < 5; i++) {
          const window = wordsA.slice(i, i + windowSize);
          if (window.every(w => wordsB.has(w))) {
            const phrase = window.join(" ");
            const idxA = textA.toLowerCase().indexOf(phrase);
            const idxB = textB.toLowerCase().indexOf(phrase);
            if (idxA >= 0 && idxB >= 0) {
              const contextA = textA.substring(Math.max(0, idxA - 30), Math.min(textA.length, idxA + phrase.length + 30));
              const contextB = textB.substring(Math.max(0, idxB - 30), Math.min(textB.length, idxB + phrase.length + 30));
              matches.push({ text: phrase.substring(0, 300), contextA: contextA.substring(0, 400), contextB: contextB.substring(0, 400) });
              i += windowSize;
            }
          }
        }
      }
      return matches;
    }

    const ngramCache = new Map<string, Set<string>>();
    for (const s of withText) {
      ngramCache.set(s.id, getNGrams(s.extractedText!, 4));
    }

    const pairs: {
      studentA: { id: string; name: string };
      studentB: { id: string; name: string };
      similarity: number;
      matchingPassages: { text: string; contextA: string; contextB: string }[];
      riskLevel: "high" | "medium" | "low";
    }[] = [];

    for (let i = 0; i < withText.length; i++) {
      for (let j = i + 1; j < withText.length; j++) {
        const a = withText[i];
        const b = withText[j];
        const ngramsA = ngramCache.get(a.id)!;
        const ngramsB = ngramCache.get(b.id)!;
        const similarity = jaccardSimilarity(ngramsA, ngramsB);

        if (similarity >= 15) {
          const matchingPassages = findMatchingPassages(a.extractedText!, b.extractedText!);
          let riskLevel: "high" | "medium" | "low" = "low";
          if (similarity >= 50 || matchingPassages.length >= 3) riskLevel = "high";
          else if (similarity >= 30 || matchingPassages.length >= 1) riskLevel = "medium";

          pairs.push({
            studentA: { id: a.studentId, name: a.student?.name || "Unknown" },
            studentB: { id: b.studentId, name: b.student?.name || "Unknown" },
            similarity,
            matchingPassages,
            riskLevel,
          });
        }
      }
    }

    pairs.sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      return b.similarity - a.similarity;
    });

    const book = await storage.getBook(assignment.bookId);
    res.json({ pairs, assignmentTitle: book?.title || "Assignment", totalSubmissions: subs.length });
  });

  app.post("/api/assignments/:id/plagiarism-flag", requireRole("teacher", "admin"), async (req, res) => {
    const assignment = await storage.getAssignment(req.params.id);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    const user = (req as any).user;
    if (user.role === "teacher") {
      const cls = await storage.getClass(assignment.classId);
      if (!cls || cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
    }
    const book = await storage.getBook(assignment.bookId);
    const assignmentTitle = book?.title || "Assignment";

    const flagSchema = z.object({
      pairs: z.array(z.object({
        studentA: z.object({ id: z.string(), name: z.string() }),
        studentB: z.object({ id: z.string(), name: z.string() }),
        similarity: z.number(),
        matchingPassages: z.array(z.object({
          text: z.string(),
          contextA: z.string().optional(),
          contextB: z.string().optional(),
        })),
        riskLevel: z.enum(["high", "medium", "low"]),
      })),
    });
    const parsed = flagSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data" });

    const subs = await storage.getSubmissionsByAssignment(req.params.id);
    const validStudentIds = new Set(subs.map(s => s.studentId));

    const notified = new Set<string>();
    for (const pair of parsed.data.pairs) {
      if (!validStudentIds.has(pair.studentA.id) || !validStudentIds.has(pair.studentB.id)) continue;
      const copiedTexts = pair.matchingPassages.map(p => `"${p.text}"`).join("\n\n");
      const passageList = copiedTexts || "(High n-gram overlap detected)";

      if (!notified.has(pair.studentA.id)) {
        await storage.createNotification({
          userId: pair.studentA.id,
          type: "plagiarism_alert",
          title: `Plagiarism Detected — ${assignmentTitle}`,
          body: `Your submission for "${assignmentTitle}" has ${pair.similarity}% similarity with ${pair.studentB.name}'s submission.\n\nCopied passages found:\n${passageList}\n\nThis is a ${pair.riskLevel}-risk flag. Please contact your teacher to discuss this matter.`,
        });
        notified.add(pair.studentA.id);
      }

      if (!notified.has(pair.studentB.id)) {
        await storage.createNotification({
          userId: pair.studentB.id,
          type: "plagiarism_alert",
          title: `Plagiarism Detected — ${assignmentTitle}`,
          body: `Your submission for "${assignmentTitle}" has ${pair.similarity}% similarity with ${pair.studentA.name}'s submission.\n\nCopied passages found:\n${passageList}\n\nThis is a ${pair.riskLevel}-risk flag. Please contact your teacher to discuss this matter.`,
        });
        notified.add(pair.studentB.id);
      }
    }

    res.json({ notifiedCount: notified.size });
  });

  // Admin Classes
  app.get("/api/admin/classes", requireRole("admin"), async (req, res) => {
    const allClasses = await storage.getAllClasses();
    const enriched = await Promise.all(allClasses.map(async (cls) => {
      const teacher = await storage.getUser(cls.teacherId);
      const students = await storage.getClassStudents(cls.id);
      return {
        ...cls,
        teacherName: teacher?.name || "Unknown",
        studentCount: students.length,
      };
    }));
    res.json(enriched);
  });

  // Admin Stats
  app.get("/api/admin/stats", requireRole("admin"), async (req, res) => {
    const stats = await storage.getAdminStats();
    res.json(stats);
  });

  // Users (for admin)
  app.get("/api/users", requireRole("admin"), async (req, res) => {
    const role = req.query.role as string;
    let userList;
    if (role && role !== "all") {
      userList = await storage.getUsersByRole(role);
    } else {
      userList = await storage.getAllUsers();
    }
    const safe = userList.map(({ password: _, ...u }) => u);
    res.json(safe);
  });

  app.get("/api/users/:id", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ message: "Not found" });
    const { password: _, ...safeUser } = user;
    const badges = await storage.getBadges(user.id);
    res.json({ ...safeUser, badges });
  });

  app.post("/api/admin/users", requireRole("admin"), async (req, res) => {
    try {
      const { username, password, name, email, role } = req.body;
      if (!username || !password || !name || !email || !role) {
        return res.status(400).json({ message: "All fields are required" });
      }
      if (!["student", "teacher", "admin"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) {
        return res.status(400).json({ message: "Username already exists" });
      }
      const user = await storage.createUser({ username, password, name, email, role });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (err: any) {
      if (err?.message?.includes("unique")) {
        return res.status(400).json({ message: "Username or email already exists" });
      }
      res.status(400).json({ message: "Failed to create user" });
    }
  });

  app.patch("/api/admin/users/:id", requireRole("admin"), async (req, res) => {
    try {
      const { name, email, role } = req.body;
      const updates: Record<string, any> = {};
      if (name) updates.name = name;
      if (email) updates.email = email;
      if (role && ["student", "teacher", "admin"].includes(role)) updates.role = role;
      const user = await storage.updateUser(req.params.id, updates);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (err: any) {
      if (err?.message?.includes("unique")) {
        return res.status(400).json({ message: "Email already exists" });
      }
      res.status(400).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", requireRole("admin"), async (req, res) => {
    const adminUser = (req as any).user;
    if (adminUser.id === req.params.id) {
      return res.status(400).json({ message: "Cannot delete yourself" });
    }
    await storage.deleteUser(req.params.id);
    res.json({ ok: true });
  });

  // Quizzes
  app.get("/api/quizzes", requireAuth, async (req, res) => {
    const { classId } = req.query;
    if (!classId) return res.status(400).json({ message: "classId is required" });
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    const cls = await storage.getClass(classId as string);
    if (!cls) return res.status(404).json({ message: "Class not found" });
    if (user.role === "student") {
      const enrolled = await storage.isEnrolled(classId as string, userId);
      if (!enrolled) return res.status(403).json({ message: "Not enrolled in this class" });
    } else if (user.role === "teacher" && cls.teacherId !== userId) {
      return res.status(403).json({ message: "Not your class" });
    }
    const quizList = await storage.getQuizzes(classId as string);
    const withAttemptCounts = await Promise.all(quizList.map(async (q) => {
      const attempts = await storage.getQuizAttempts(q.id);
      return { ...q, attemptCount: attempts.length };
    }));
    res.json(withAttemptCounts);
  });

  app.post("/api/quizzes", requireRole("teacher", "admin"), async (req, res) => {
    try {
      const user = (req as any).user;
      const { classId, title, questions, timeLimitSeconds, antiCheatEnabled } = req.body;
      if (!classId || !title || !questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "classId, title, and at least one question are required" });
      }
      const quiz = await storage.createQuiz({
        classId,
        title,
        questions,
        timeLimitSeconds: timeLimitSeconds ? parseInt(timeLimitSeconds) : undefined,
        antiCheatEnabled: !!antiCheatEnabled,
        createdBy: user.id,
      });
      const students = await storage.getClassStudents(classId);
      for (const student of students) {
        await storage.createNotification({
          userId: student.id,
          type: "quiz_available",
          title: "New Quiz Available",
          body: `A new quiz "${title}" is now available. Good luck!`,
        });
      }
      res.json(quiz);
    } catch (err) {
      res.status(400).json({ message: "Invalid quiz data" });
    }
  });

  app.get("/api/quizzes/:id", requireAuth, async (req, res) => {
    const quiz = await storage.getQuiz(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    if (user.role === "student") {
      const enrolled = await storage.isEnrolled(quiz.classId, userId);
      if (!enrolled) return res.status(403).json({ message: "Not enrolled in this class" });
      const existingAttempt = await storage.getStudentQuizAttempt(quiz.id, userId);
      return res.json({ ...quiz, existingAttempt: existingAttempt || null });
    }
    if (user.role === "teacher") {
      const cls = await storage.getClass(quiz.classId);
      if (cls && cls.teacherId !== userId) return res.status(403).json({ message: "Not your class" });
    }
    res.json(quiz);
  });

  app.delete("/api/quizzes/:id", requireRole("teacher", "admin"), async (req, res) => {
    await storage.deleteQuiz(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/quizzes/:id/results", requireRole("teacher", "admin"), async (req, res) => {
    const quiz = await storage.getQuiz(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });
    const user = (req as any).user;
    if (user.role === "teacher") {
      const cls = await storage.getClass(quiz.classId);
      if (cls && cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
    }
    const attempts = await storage.getQuizAttempts(req.params.id);
    const safe = attempts.map(a => ({
      ...a,
      student: a.student ? { ...a.student, password: undefined } : undefined,
    }));
    res.json(safe);
  });

  app.get("/api/quizzes/:id/plagiarism", requireRole("teacher", "admin"), async (req, res) => {
    const quiz = await storage.getQuiz(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });
    const user = (req as any).user;
    if (user.role === "teacher") {
      const cls = await storage.getClass(quiz.classId);
      if (!cls || cls.teacherId !== user.id) return res.status(403).json({ message: "Not your class" });
    }

    const attempts = await storage.getQuizAttempts(req.params.id);
    if (attempts.length < 2) return res.json({ pairs: [], quizTitle: quiz.title, totalAttempts: attempts.length });

    const questions = quiz.questions as { question: string; options: string[]; correctIndex: number }[];
    const pairs: {
      studentA: { id: string; name: string };
      studentB: { id: string; name: string };
      similarity: number;
      matchingWrong: number;
      totalQuestions: number;
      matchingAnswers: number;
      details: { questionIndex: number; question: string; answerA: number; answerB: number; correct: number; bothWrong: boolean }[];
      riskLevel: "high" | "medium" | "low";
    }[] = [];

    for (let i = 0; i < attempts.length; i++) {
      for (let j = i + 1; j < attempts.length; j++) {
        const a = attempts[i];
        const b = attempts[j];
        const answersA = a.answers as number[];
        const answersB = b.answers as number[];
        if (!answersA?.length || !answersB?.length) continue;

        let matchingAnswers = 0;
        let matchingWrong = 0;
        const details: typeof pairs[0]["details"] = [];

        let answeredByBoth = 0;
        for (let q = 0; q < Math.min(answersA.length, answersB.length, questions.length); q++) {
          if (answersA[q] === null || answersA[q] === undefined || answersB[q] === null || answersB[q] === undefined) continue;
          answeredByBoth++;
          const same = answersA[q] === answersB[q];
          const correctIdx = questions[q]?.correctIndex;
          const bothWrong = same && answersA[q] !== correctIdx;

          if (same) matchingAnswers++;
          if (bothWrong) matchingWrong++;

          if (same) {
            details.push({
              questionIndex: q,
              question: questions[q]?.question || `Question ${q + 1}`,
              answerA: answersA[q],
              answerB: answersB[q],
              correct: correctIdx,
              bothWrong,
            });
          }
        }

        const totalQ = answeredByBoth;
        const similarity = totalQ > 0 ? Math.round((matchingAnswers / totalQ) * 100) : 0;

        let riskLevel: "high" | "medium" | "low" = "low";
        if (matchingWrong >= 3 || (matchingWrong >= 2 && similarity >= 80)) riskLevel = "high";
        else if (matchingWrong >= 2 || (matchingWrong >= 1 && similarity >= 90)) riskLevel = "medium";

        if (similarity >= 60) {
          pairs.push({
            studentA: { id: a.studentId, name: a.student?.name || "Unknown" },
            studentB: { id: b.studentId, name: b.student?.name || "Unknown" },
            similarity,
            matchingWrong,
            totalQuestions: totalQ,
            matchingAnswers,
            details,
            riskLevel,
          });
        }
      }
    }

    pairs.sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      return b.similarity - a.similarity;
    });

    res.json({ pairs, quizTitle: quiz.title, totalAttempts: attempts.length });
  });

  app.post("/api/quizzes/:id/attempt", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "student") return res.status(403).json({ message: "Only students can take quizzes" });

      const quiz = await storage.getQuiz(req.params.id);
      if (!quiz) return res.status(404).json({ message: "Quiz not found" });

      const enrolled = await storage.isEnrolled(quiz.classId, userId);
      if (!enrolled) return res.status(403).json({ message: "Not enrolled in this class" });

      const existing = await storage.getStudentQuizAttempt(quiz.id, userId);
      if (existing) return res.status(400).json({ message: "You have already taken this quiz" });

      const { answers, flags } = req.body;
      if (!answers || !Array.isArray(answers)) return res.status(400).json({ message: "Answers are required" });

      const questions = quiz.questions as any[];
      let correct = 0;
      for (let i = 0; i < questions.length; i++) {
        if (answers[i] === questions[i].correctIndex) {
          correct++;
        }
      }
      const scorePercent = Math.round((correct / questions.length) * 100);

      const attempt = await storage.createQuizAttempt({
        studentId: userId,
        quizId: quiz.id,
        score: scorePercent,
        answers: answers || [],
        flags: flags || [],
      });

      let xpAwarded = 0;
      if (scorePercent >= 80) {
        xpAwarded = 100;
        await storage.updateUser(userId, { xp: user.xp + xpAwarded });
        const newLevel = Math.floor((user.xp + xpAwarded) / 200) + 1;
        if (newLevel > user.level) {
          await storage.updateUser(userId, { level: newLevel });
        }
      }

      if (scorePercent === 100) {
        const hasPerfect = await storage.hasBadge(userId, "perfect_quiz");
        if (!hasPerfect) {
          await storage.awardBadge({ userId, badgeType: "perfect_quiz", label: "Perfect Quiz" });
          await storage.createNotification({
            userId,
            type: "badge_earned",
            title: "Badge Earned!",
            body: "You earned the 'Perfect Quiz' badge for scoring 100%!",
          });
        }
      }

      res.json({ ...attempt, correct, total: questions.length, scorePercent, xpAwarded });
    } catch (err) {
      res.status(400).json({ message: "Failed to submit quiz" });
    }
  });

  app.get("/api/quiz-attempts/mine", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const attempts = await storage.getStudentQuizAttempts(userId);
    res.json(attempts);
  });

  const announcementSchema = z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(2000),
    target: z.enum(["all", "students", "teachers"]),
    classId: z.string().optional(),
  });

  app.post("/api/admin/announcements", requireRole("admin"), async (req, res) => {
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid announcement data" });
    const { title, body, target, classId } = parsed.data;

    let targetUsers: { id: string }[] = [];

    if (classId) {
      const students = await storage.getClassStudents(classId);
      targetUsers = students.map(s => ({ id: s.id }));
    } else if (target === "all") {
      const allUsers = await storage.getAllUsers();
      targetUsers = allUsers.map(u => ({ id: u.id }));
    } else if (target === "students") {
      const students = await storage.getUsersByRole("student");
      targetUsers = students.map(s => ({ id: s.id }));
    } else if (target === "teachers") {
      const teachers = await storage.getUsersByRole("teacher");
      targetUsers = teachers.map(t => ({ id: t.id }));
    }

    let notifiedCount = 0;
    for (const u of targetUsers) {
      await storage.createNotification({
        userId: u.id,
        type: "announcement",
        title,
        body,
      });
      notifiedCount++;
    }

    res.json({ ok: true, notifiedCount });
  });

  app.get("/api/classmates", requireRole("student"), async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const classmates = await storage.getClassmates(userId);
      const safe = classmates.filter(c => c.role === "student").map(({ password: _, ...c }) => c);
      res.json(safe);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch classmates" });
    }
  });

  app.get("/api/messages/unread-count", requireRole("student"), async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const count = await storage.getUnreadMessageCount(userId);
      res.json({ count });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.get("/api/messages/conversations", requireRole("student"), async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const conversations = await storage.getConversations(userId);
      const classmates = await storage.getClassmates(userId);
      const classmateIds = new Set(classmates.filter(c => c.role === "student").map(c => c.id));
      const safe = conversations
        .filter(c => classmateIds.has(c.user.id))
        .map(c => ({
          ...c,
          user: { ...c.user, password: undefined },
        }));
      res.json(safe);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/messages/:userId", requireRole("student"), async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const otherUserId = req.params.userId as string;
      const otherUser = await storage.getUser(otherUserId);
      if (!otherUser || otherUser.role !== "student") return res.status(403).json({ message: "You can only message classmates" });
      const areFriends = await storage.areClassmates(userId, otherUserId);
      if (!areFriends) return res.status(403).json({ message: "You can only message classmates" });
      const messages = await storage.getMessages(userId, otherUserId);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/messages/:userId", requireRole("student"), async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const receiverId = req.params.userId as string;
      const { content } = req.body;
      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({ message: "Message content is required" });
      }
      const otherUser = await storage.getUser(receiverId);
      if (!otherUser || otherUser.role !== "student") return res.status(403).json({ message: "You can only message classmates" });
      const areFriends = await storage.areClassmates(userId, receiverId);
      if (!areFriends) return res.status(403).json({ message: "You can only message classmates" });
      const message = await storage.sendMessage(userId, receiverId, content.trim());
      res.json(message);
    } catch (err) {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.patch("/api/messages/:userId/read", requireRole("student"), async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const otherUserId = req.params.userId as string;
      const areFriends = await storage.areClassmates(userId, otherUserId);
      if (!areFriends) return res.status(403).json({ message: "You can only message classmates" });
      await storage.markMessagesRead(userId, otherUserId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to mark messages as read" });
    }
  });

  return httpServer;
}
