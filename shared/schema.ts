import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("student"),
  institutionId: varchar("institution_id"),
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(1),
  streakDays: integer("streak_days").notNull().default(0),
  learningStyle: text("learning_style"),
  styleConfidence: real("style_confidence").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const institutions = pgTable("institutions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  adminId: varchar("admin_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const classes = pgTable("classes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teacherId: varchar("teacher_id").notNull(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  scheduleTime: text("schedule_time"),
  gamificationEnabled: boolean("gamification_enabled").default(true),
  joinCode: text("join_code").notNull(),
  institutionId: varchar("institution_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const classEnrollments = pgTable("class_enrollments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  classId: varchar("class_id").notNull(),
  studentId: varchar("student_id").notNull(),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const sessions = pgTable("lectures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  classId: varchar("class_id").notNull(),
  teacherId: varchar("teacher_id").notNull(),
  title: text("title"),
  status: text("status").notNull().default("scheduled"),
  avgAttention: real("avg_attention"),
  peakAttention: real("peak_attention"),
  boredCount: integer("bored_count").default(0),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  transcript: text("transcript"),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const attentionScores = pgTable("attention_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  studentId: varchar("student_id").notNull(),
  score: real("score").notNull(),
  emotion: text("emotion").notNull().default("neutral"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const attendances = pgTable("attendances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  studentId: varchar("student_id").notNull(),
  isPresent: boolean("is_present").notNull().default(false),
  isAttended: boolean("is_attended").notNull().default(false),
  averageFocus: real("average_focus").default(0),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const books = pgTable("books", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  uploadedBy: varchar("uploaded_by").notNull(),
  subject: text("subject").notNull(),
  totalPages: integer("total_pages").notNull().default(1),
  tags: text("tags").array(),
  coverColor: text("cover_color"),
  pdfPath: text("pdf_path"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const assignments = pgTable("assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookId: varchar("book_id").notNull(),
  classId: varchar("class_id").notNull(),
  dueAt: timestamp("due_at"),
  timerSeconds: integer("timer_seconds"),
  allowSkip: boolean("allow_skip").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const readingSessions = pgTable("reading_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studentId: varchar("student_id").notNull(),
  assignmentId: varchar("assignment_id").notNull(),
  completedPages: integer("completed_pages").default(0),
  boredCount: integer("bored_count").default(0),
  timeSpentSeconds: integer("time_spent_seconds").default(0),
  completedAt: timestamp("completed_at"),
  startedAt: timestamp("started_at").defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const badges = pgTable("badges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  badgeType: text("badge_type").notNull(),
  label: text("label").notNull(),
  earnedAt: timestamp("earned_at").defaultNow(),
});

export const quizzes = pgTable("quizzes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  classId: varchar("class_id").notNull(),
  title: text("title").notNull(),
  questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
  timeLimitSeconds: integer("time_limit_seconds"),
  antiCheatEnabled: boolean("anti_cheat_enabled").default(false),
  sourceType: text("source_type").notNull().default("manual"),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const quizAttempts = pgTable("quiz_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  studentId: varchar("student_id").notNull(),
  quizId: varchar("quiz_id").notNull(),
  score: integer("score").default(0),
  answers: jsonb("answers").default(sql`'[]'::jsonb`),
  flags: jsonb("flags").default(sql`'[]'::jsonb`),
  completedAt: timestamp("completed_at").defaultNow(),
});

export const assignmentSubmissions = pgTable("assignment_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assignmentId: varchar("assignment_id").notNull(),
  studentId: varchar("student_id").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  extractedText: text("extracted_text"),
  grade: integer("grade"),
  feedback: text("feedback"),
  gradedAt: timestamp("graded_at"),
  submittedAt: timestamp("submitted_at").defaultNow(),
});

export const directMessages = pgTable("direct_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderId: varchar("sender_id").notNull(),
  receiverId: varchar("receiver_id").notNull(),
  content: text("content").notNull(),
  read: boolean("read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sessionTable = pgTable("session", {
  sid: varchar("sid").primaryKey().notNull(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  name: true,
  email: true,
  role: true,
  institutionId: true,
});

export const insertClassSchema = createInsertSchema(classes).pick({
  title: true,
  subject: true,
  scheduleTime: true,
  gamificationEnabled: true,
});

export const insertSessionSchema = createInsertSchema(sessions).pick({
  classId: true,
  title: true,
});

export const insertBookSchema = createInsertSchema(books).pick({
  title: true,
  subject: true,
  totalPages: true,
  tags: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).pick({
  userId: true,
  type: true,
  title: true,
  body: true,
});

export const insertQuizSchema = createInsertSchema(quizzes).pick({
  classId: true,
  title: true,
  timeLimitSeconds: true,
  antiCheatEnabled: true,
});

export const insertDirectMessageSchema = createInsertSchema(directMessages).omit({
  id: true,
  read: true,
  createdAt: true,
});

export type InsertDirectMessage = z.infer<typeof insertDirectMessageSchema>;

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Institution = typeof institutions.$inferSelect;
export type Class = typeof classes.$inferSelect;
export type ClassEnrollment = typeof classEnrollments.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AttentionScore = typeof attentionScores.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type Book = typeof books.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type ReadingSession = typeof readingSessions.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Badge = typeof badges.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type AssignmentSubmission = typeof assignmentSubmissions.$inferSelect;
export type DirectMessage = typeof directMessages.$inferSelect;
