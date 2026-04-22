import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { Pool } from "pg";

import { eq, and, desc, sql } from "drizzle-orm";
import {
  users, institutions, classes, classEnrollments, sessions as sessionsTable,
  attentionScores, attendances, books, assignments, readingSessions, notifications,
  badges, quizzes, quizAttempts, assignmentSubmissions, directMessages,
  type User, type InsertUser, type Institution, type Class,
  type ClassEnrollment, type Session, type AttentionScore, type Attendance,
  type Book, type Assignment, type ReadingSession, type Notification,
  type Badge, type Quiz, type QuizAttempt, type AssignmentSubmission,
  type DirectMessage,
} from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is missing. Please set it in your environment.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

export async function runMigrations() {
  console.log("Running database migrations...");
  try {
    // In both dev and prod, we run from the project root
    const migrationsPath = path.join(process.cwd(), "migrations");
    
    await migrate(db, { migrationsFolder: migrationsPath });
    console.log("Migrations completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser & { name: string; email: string }): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  getUsersByRole(role: string): Promise<User[]>;

  getAllUsers(): Promise<User[]>;
  deleteUser(id: string): Promise<void>;

  // Institutions
  createInstitution(name: string, adminId: string): Promise<Institution>;
  getInstitution(id: string): Promise<Institution | undefined>;

  // Classes
  getClasses(teacherId: string): Promise<Class[]>;
  getAllClasses(): Promise<Class[]>;
  getClass(id: string): Promise<Class | undefined>;
  getClassByJoinCode(code: string): Promise<Class | undefined>;
  createClass(data: { teacherId: string; title: string; subject: string; scheduleTime?: string; gamificationEnabled?: boolean; joinCode: string; institutionId?: string }): Promise<Class>;
  updateClass(id: string, data: Partial<Class>): Promise<Class | undefined>;
  deleteClass(id: string): Promise<void>;

  // Enrollments
  enrollStudent(classId: string, studentId: string): Promise<ClassEnrollment>;
  getClassStudents(classId: string): Promise<User[]>;
  getStudentClasses(studentId: string): Promise<Class[]>;
  isEnrolled(classId: string, studentId: string): Promise<boolean>;
  unenrollStudent(classId: string, studentId: string): Promise<void>;

  // Sessions
  getSessions(classId: string): Promise<Session[]>;
  getSession(id: string): Promise<Session | undefined>;
  createSession(data: { classId: string; teacherId: string; title?: string }): Promise<Session>;
  updateSession(id: string, data: Partial<Session>): Promise<Session | undefined>;
  getTeacherSessions(teacherId: string): Promise<Session[]>;
  getStudentLiveSessions(studentId: string): Promise<(Session & { classTitle: string })[]>;

  // Attention Scores
  addAttentionScore(data: { sessionId: string; studentId: string; score: number; emotion: string }): Promise<AttentionScore>;
  getSessionScores(sessionId: string): Promise<AttentionScore[]>;
  getStudentSessionScore(sessionId: string, studentId: string): Promise<AttentionScore[]>;

  // Attendances
  getAttendances(sessionId: string): Promise<Attendance[]>;
  createAttendance(data: { sessionId: string; studentId: string; isPresent: boolean; isAttended: boolean; averageFocus: number }): Promise<Attendance>;

  // Books
  getBooks(teacherId?: string): Promise<Book[]>;
  getBook(id: string): Promise<Book | undefined>;
  createBook(data: { title: string; uploadedBy: string; subject: string; totalPages: number; tags?: string[]; coverColor?: string; pdfPath?: string | null }): Promise<Book>;
  deleteBook(id: string): Promise<void>;

  // Assignments
  getAssignments(classId: string): Promise<Assignment[]>;
  getAssignment(id: string): Promise<Assignment | undefined>;
  createAssignment(data: { bookId: string; classId: string; dueAt?: Date; timerSeconds?: number; allowSkip?: boolean }): Promise<Assignment>;
  getStudentAssignments(studentId: string): Promise<(Assignment & { book: Book; class: Class })[]>;

  // Reading Sessions
  createReadingSession(data: { studentId: string; assignmentId: string }): Promise<ReadingSession>;
  updateReadingSession(id: string, data: Partial<ReadingSession>): Promise<ReadingSession | undefined>;
  getReadingSession(studentId: string, assignmentId: string): Promise<ReadingSession | undefined>;

  // Notifications
  getNotifications(userId: string): Promise<Notification[]>;
  createNotification(data: { userId: string; type: string; title: string; body: string }): Promise<Notification>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<void>;

  // Badges
  getBadges(userId: string): Promise<Badge[]>;
  awardBadge(data: { userId: string; badgeType: string; label: string }): Promise<Badge>;
  hasBadge(userId: string, badgeType: string): Promise<boolean>;

  // Quizzes
  getQuizzes(classId: string): Promise<Quiz[]>;
  getQuiz(id: string): Promise<Quiz | undefined>;
  createQuiz(data: { classId: string; title: string; questions: unknown[]; timeLimitSeconds?: number; antiCheatEnabled?: boolean; sourceType?: string; createdBy: string }): Promise<Quiz>;
  deleteQuiz(id: string): Promise<void>;
  createQuizAttempt(data: { studentId: string; quizId: string; score: number; answers: unknown[]; flags: unknown[] }): Promise<QuizAttempt>;
  getQuizAttempts(quizId: string): Promise<(QuizAttempt & { student?: User })[]>;
  getStudentQuizAttempts(studentId: string): Promise<(QuizAttempt & { quiz?: Quiz })[]>;
  getStudentQuizAttempt(quizId: string, studentId: string): Promise<QuizAttempt | undefined>;

  // Analytics
  getClassAnalytics(classId: string): Promise<{ avgAttention: number; sessionCount: number; studentCount: number; boredCount: number }>;
  getStudentAnalytics(studentId: string): Promise<{ avgAttention: number; sessionsAttended: number; readingCompleted: number; totalXp: number }>;
  getLeaderboard(classId: string): Promise<{ user: User; xp: number; rank: number }[]>;

  // Assignment Submissions
  createSubmission(data: { assignmentId: string; studentId: string; fileName: string; filePath: string; fileType: string; fileSize: number; extractedText?: string }): Promise<AssignmentSubmission>;
  getSubmission(id: string): Promise<AssignmentSubmission | undefined>;
  getSubmissionsByAssignment(assignmentId: string): Promise<(AssignmentSubmission & { student?: User })[]>;
  getStudentSubmission(assignmentId: string, studentId: string): Promise<AssignmentSubmission | undefined>;
  gradeSubmission(id: string, grade: number, feedback?: string): Promise<AssignmentSubmission | undefined>;
  updateSubmissionText(id: string, text: string): Promise<void>;
  deleteSubmission(id: string): Promise<void>;

  // Admin Stats
  getAdminStats(): Promise<{
    totalStudents: number;
    totalTeachers: number;
    totalClasses: number;
    totalSessions: number;
    totalSubmissions: number;
    totalQuizAttempts: number;
    avgAttention: number;
    topStudents: { id: string; name: string; xp: number; level: number }[];
    recentActivity: { type: string; title: string; body: string; createdAt: Date | null }[];
  }>;

  // Direct Messages
  getConversations(userId: string): Promise<{ user: User; lastMessage: DirectMessage; unreadCount: number }[]>;
  getMessages(userId: string, otherUserId: string): Promise<DirectMessage[]>;
  sendMessage(senderId: string, receiverId: string, content: string): Promise<DirectMessage>;
  markMessagesRead(userId: string, fromUserId: string): Promise<void>;
  getUnreadMessageCount(userId: string): Promise<number>;
  areClassmates(userId1: string, userId2: string): Promise<boolean>;
  getClassmates(userId: string): Promise<User[]>;

  // AI Advisor
  getTeacherOverviewForAI(teacherId: string): Promise<{
    totalClasses: number;
    totalStudents: number;
    totalSessions: number;
    classes: {
      className: string;
      subject: string;
      studentCount: number;
      sessionCount: number;
      avgAttention: number;
      boredCount: number;
      topStudents: string[];
      lowXpStudents: string[];
      students: { name: string; xp: number; level: number; streakDays: number; learningStyle: string | null }[];
    }[];
  }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(data: InsertUser & { name: string; email: string }) {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<User>) {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async getUsersByRole(role: string) {
    return db.select().from(users).where(eq(users.role, role));
  }

  async getAllUsers() {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async deleteUser(id: string) {
    const user = await this.getUser(id);
    if (user?.role === "teacher") {
      const teacherClasses = await db.select({ id: classes.id }).from(classes).where(eq(classes.teacherId, id));
      for (const cls of teacherClasses) {
        await this.deleteClass(cls.id);
      }
      await db.delete(sessionsTable).where(eq(sessionsTable.teacherId, id));
    }
    await db.delete(assignmentSubmissions).where(eq(assignmentSubmissions.studentId, id));
    await db.delete(readingSessions).where(eq(readingSessions.studentId, id));
    await db.delete(classEnrollments).where(eq(classEnrollments.studentId, id));
    await db.delete(notifications).where(eq(notifications.userId, id));
    await db.delete(badges).where(eq(badges.userId, id));
    await db.delete(attentionScores).where(eq(attentionScores.studentId, id));
    await db.delete(quizAttempts).where(eq(quizAttempts.studentId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async createInstitution(name: string, adminId: string) {
    const [inst] = await db.insert(institutions).values({ name, adminId }).returning();
    return inst;
  }

  async getInstitution(id: string) {
    const [inst] = await db.select().from(institutions).where(eq(institutions.id, id));
    return inst;
  }

  async getClasses(teacherId: string) {
    return db.select().from(classes).where(eq(classes.teacherId, teacherId)).orderBy(desc(classes.createdAt));
  }

  async getAllClasses() {
    return db.select().from(classes).orderBy(desc(classes.createdAt));
  }

  async getClass(id: string) {
    const [cls] = await db.select().from(classes).where(eq(classes.id, id));
    return cls;
  }

  async getClassByJoinCode(code: string) {
    const [cls] = await db.select().from(classes).where(eq(classes.joinCode, code.toUpperCase()));
    return cls;
  }

  async createClass(data: { teacherId: string; title: string; subject: string; scheduleTime?: string; gamificationEnabled?: boolean; joinCode: string; institutionId?: string }) {
    const [cls] = await db.insert(classes).values(data).returning();
    return cls;
  }

  async updateClass(id: string, data: Partial<Class>) {
    const [cls] = await db.update(classes).set(data).where(eq(classes.id, id)).returning();
    return cls;
  }

  async deleteClass(id: string) {
    const classQuizzes = await db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.classId, id));
    for (const q of classQuizzes) {
      await db.delete(quizAttempts).where(eq(quizAttempts.quizId, q.id));
    }
    await db.delete(quizzes).where(eq(quizzes.classId, id));
    const classAssignments = await db.select({ id: assignments.id }).from(assignments).where(eq(assignments.classId, id));
    for (const a of classAssignments) {
      await db.delete(assignmentSubmissions).where(eq(assignmentSubmissions.assignmentId, a.id));
      await db.delete(readingSessions).where(eq(readingSessions.assignmentId, a.id));
    }
    await db.delete(assignments).where(eq(assignments.classId, id));
    const classSessions = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.classId, id));
    for (const s of classSessions) {
      await db.delete(attentionScores).where(eq(attentionScores.sessionId, s.id));
    }
    await db.delete(sessionsTable).where(eq(sessionsTable.classId, id));
    await db.delete(classEnrollments).where(eq(classEnrollments.classId, id));
    await db.delete(classes).where(eq(classes.id, id));
  }

  async enrollStudent(classId: string, studentId: string) {
    const [enrollment] = await db.insert(classEnrollments).values({ classId, studentId }).returning();
    return enrollment;
  }

  async getClassStudents(classId: string) {
    const enrollments = await db.select().from(classEnrollments).where(eq(classEnrollments.classId, classId));
    const studentIds = enrollments.map(e => e.studentId);
    if (studentIds.length === 0) return [];
    const students = await Promise.all(studentIds.map(id => this.getUser(id)));
    return students.filter(Boolean) as User[];
  }

  async getStudentClasses(studentId: string) {
    const enrollments = await db.select().from(classEnrollments).where(eq(classEnrollments.studentId, studentId));
    const classIds = enrollments.map(e => e.classId);
    if (classIds.length === 0) return [];
    const cls = await Promise.all(classIds.map(id => this.getClass(id)));
    return cls.filter(Boolean) as Class[];
  }

  async isEnrolled(classId: string, studentId: string) {
    const [enrollment] = await db.select().from(classEnrollments).where(
      and(eq(classEnrollments.classId, classId), eq(classEnrollments.studentId, studentId))
    );
    return !!enrollment;
  }

  async unenrollStudent(classId: string, studentId: string) {
    await db.delete(classEnrollments).where(
      and(eq(classEnrollments.classId, classId), eq(classEnrollments.studentId, studentId))
    );
  }

  async getSessions(classId: string) {
    return db.select().from(sessionsTable).where(eq(sessionsTable.classId, classId)).orderBy(desc(sessionsTable.createdAt));
  }

  async getSession(id: string) {
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
    return session;
  }

  async createSession(data: { classId: string; teacherId: string; title?: string }) {
    const [session] = await db.insert(sessionsTable).values({ ...data, status: "live", startedAt: new Date() }).returning();
    return session;
  }

  async updateSession(id: string, data: Partial<Session>) {
    const [session] = await db.update(sessionsTable).set(data).where(eq(sessionsTable.id, id)).returning();
    return session;
  }

  async getTeacherSessions(teacherId: string) {
    return db.select().from(sessionsTable).where(eq(sessionsTable.teacherId, teacherId)).orderBy(desc(sessionsTable.createdAt)).limit(20);
  }

  async getStudentLiveSessions(studentId: string) {
    const rows = await db
      .select({
        id: sessionsTable.id,
        classId: sessionsTable.classId,
        teacherId: sessionsTable.teacherId,
        title: sessionsTable.title,
        status: sessionsTable.status,
        avgAttention: sessionsTable.avgAttention,
        peakAttention: sessionsTable.peakAttention,
        boredCount: sessionsTable.boredCount,
        startedAt: sessionsTable.startedAt,
        endedAt: sessionsTable.endedAt,
        createdAt: sessionsTable.createdAt,
        classTitle: classes.title,
      })
      .from(sessionsTable)
      .innerJoin(classEnrollments, eq(sessionsTable.classId, classEnrollments.classId))
      .innerJoin(classes, eq(sessionsTable.classId, classes.id))
      .where(
        and(
          eq(classEnrollments.studentId, studentId),
          eq(sessionsTable.status, "live")
        )
      )
      .orderBy(desc(sessionsTable.startedAt));
    return rows;
  }

  async addAttentionScore(data: { sessionId: string; studentId: string; score: number; emotion: string }) {
    const [score] = await db.insert(attentionScores).values(data).returning();
    return score;
  }

  async getSessionScores(sessionId: string) {
    return db.select().from(attentionScores).where(eq(attentionScores.sessionId, sessionId)).orderBy(attentionScores.timestamp);
  }

  async getStudentSessionScore(sessionId: string, studentId: string) {
    return db.select().from(attentionScores).where(
      and(eq(attentionScores.sessionId, sessionId), eq(attentionScores.studentId, studentId))
    ).orderBy(attentionScores.timestamp);
  }

  async getAttendances(sessionId: string) {
    return db.select().from(attendances).where(eq(attendances.sessionId, sessionId));
  }

  async createAttendance(data: { sessionId: string; studentId: string; isPresent: boolean; isAttended: boolean; averageFocus: number }) {
    const [attendance] = await db.insert(attendances).values(data).returning();
    return attendance;
  }

  async getBooks(teacherId?: string) {
    if (teacherId) {
      return db.select().from(books).where(eq(books.uploadedBy, teacherId)).orderBy(desc(books.createdAt));
    }
    return db.select().from(books).orderBy(desc(books.createdAt));
  }

  async getBook(id: string) {
    const [book] = await db.select().from(books).where(eq(books.id, id));
    return book;
  }

  async createBook(data: { title: string; uploadedBy: string; subject: string; totalPages: number; tags?: string[]; coverColor?: string; pdfPath?: string | null }) {
    const [book] = await db.insert(books).values(data).returning();
    return book;
  }

  async deleteBook(id: string) {
    await db.delete(books).where(eq(books.id, id));
  }

  async getAssignments(classId: string) {
    return db.select().from(assignments).where(eq(assignments.classId, classId)).orderBy(desc(assignments.createdAt));
  }

  async getAssignment(id: string) {
    const [assignment] = await db.select().from(assignments).where(eq(assignments.id, id));
    return assignment;
  }

  async createAssignment(data: { bookId: string; classId: string; dueAt?: Date; timerSeconds?: number; allowSkip?: boolean }) {
    const [assignment] = await db.insert(assignments).values(data).returning();
    return assignment;
  }

  async getStudentAssignments(studentId: string) {
    const studentClasses = await this.getStudentClasses(studentId);
    const classIds = studentClasses.map(c => c.id);
    if (classIds.length === 0) return [];

    const results: (Assignment & { book: Book; class: Class })[] = [];
    for (const cls of studentClasses) {
      const classAssignments = await this.getAssignments(cls.id);
      for (const assignment of classAssignments) {
        const book = await this.getBook(assignment.bookId);
        if (book) {
          results.push({ ...assignment, book, class: cls });
        }
      }
    }
    return results;
  }

  async createReadingSession(data: { studentId: string; assignmentId: string }) {
    const [rs] = await db.insert(readingSessions).values(data).returning();
    return rs;
  }

  async updateReadingSession(id: string, data: Partial<ReadingSession>) {
    const [rs] = await db.update(readingSessions).set(data).where(eq(readingSessions.id, id)).returning();
    return rs;
  }

  async getReadingSession(studentId: string, assignmentId: string) {
    const [rs] = await db.select().from(readingSessions).where(
      and(eq(readingSessions.studentId, studentId), eq(readingSessions.assignmentId, assignmentId))
    );
    return rs;
  }

  async getNotifications(userId: string) {
    return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(20);
  }

  async createNotification(data: { userId: string; type: string; title: string; body: string }) {
    const [notif] = await db.insert(notifications).values(data).returning();
    return notif;
  }

  async markNotificationRead(id: string) {
    await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
  }

  async markAllNotificationsRead(userId: string) {
    await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
  }

  async getBadges(userId: string) {
    return db.select().from(badges).where(eq(badges.userId, userId)).orderBy(desc(badges.earnedAt));
  }

  async awardBadge(data: { userId: string; badgeType: string; label: string }) {
    const [badge] = await db.insert(badges).values(data).returning();
    return badge;
  }

  async hasBadge(userId: string, badgeType: string) {
    const [badge] = await db.select().from(badges).where(
      and(eq(badges.userId, userId), eq(badges.badgeType, badgeType))
    );
    return !!badge;
  }

  async getQuizzes(classId: string) {
    return db.select().from(quizzes).where(eq(quizzes.classId, classId)).orderBy(desc(quizzes.createdAt));
  }

  async getQuiz(id: string) {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, id));
    return quiz;
  }

  async createQuiz(data: { classId: string; title: string; questions: unknown[]; timeLimitSeconds?: number; antiCheatEnabled?: boolean; sourceType?: string; createdBy: string }) {
    const [quiz] = await db.insert(quizzes).values(data).returning();
    return quiz;
  }

  async deleteQuiz(id: string) {
    await db.delete(quizAttempts).where(eq(quizAttempts.quizId, id));
    await db.delete(quizzes).where(eq(quizzes.id, id));
  }

  async createQuizAttempt(data: { studentId: string; quizId: string; score: number; answers: unknown[]; flags: unknown[] }) {
    const [attempt] = await db.insert(quizAttempts).values(data).returning();
    return attempt;
  }

  async getQuizAttempts(quizId: string) {
    const attempts = await db.select().from(quizAttempts).where(eq(quizAttempts.quizId, quizId)).orderBy(desc(quizAttempts.completedAt));
    const withStudents = await Promise.all(attempts.map(async (a) => {
      const student = await this.getUser(a.studentId);
      return { ...a, student };
    }));
    return withStudents;
  }

  async getStudentQuizAttempts(studentId: string) {
    const attempts = await db.select().from(quizAttempts).where(eq(quizAttempts.studentId, studentId)).orderBy(desc(quizAttempts.completedAt));
    const withQuizzes = await Promise.all(attempts.map(async (a) => {
      const quiz = await this.getQuiz(a.quizId);
      return { ...a, quiz };
    }));
    return withQuizzes;
  }

  async getStudentQuizAttempt(quizId: string, studentId: string) {
    const [attempt] = await db.select().from(quizAttempts).where(
      and(eq(quizAttempts.quizId, quizId), eq(quizAttempts.studentId, studentId))
    );
    return attempt;
  }

  async getClassAnalytics(classId: string) {
    const sessionList = await this.getSessions(classId);
    const students = await this.getClassStudents(classId);
    const sessionCount = sessionList.length;
    const studentCount = students.length;
    const completedSessions = sessionList.filter(s => s.avgAttention !== null);
    const avgAttention = completedSessions.length > 0
      ? completedSessions.reduce((sum, s) => sum + (s.avgAttention || 0), 0) / completedSessions.length
      : 0;
    const boredCount = sessionList.reduce((sum, s) => sum + (s.boredCount || 0), 0);
    return { avgAttention: Math.round(avgAttention), sessionCount, studentCount, boredCount };
  }

  async getStudentAnalytics(studentId: string) {
    const user = await this.getUser(studentId);
    const studentClasses = await this.getStudentClasses(studentId);
    const sessionsAttended = studentClasses.length * 3; // approximation
    const readingSessions_ = await db.select().from(readingSessions).where(eq(readingSessions.studentId, studentId));
    const readingCompleted = readingSessions_.filter(rs => rs.completedAt).length;
    return {
      avgAttention: 72,
      sessionsAttended,
      readingCompleted,
      totalXp: user?.xp || 0,
    };
  }

  async getStudentReportData(studentId: string, classId: string) {
    const student = await this.getUser(studentId);
    if (!student) return null;

    const classSessions = await this.getSessions(classId);
    const sessionIds = classSessions.map(s => s.id);

    let attendedCount = 0;
    let totalAttention = 0;
    let attentionCount = 0;
    for (const sid of sessionIds) {
      const scores = await this.getStudentSessionScore(sid, studentId);
      if (scores.length > 0) {
        attendedCount++;
        const avg = scores.reduce((s, sc) => s + sc.score, 0) / scores.length;
        totalAttention += avg;
        attentionCount++;
      }
    }

    const avgAttention = attentionCount > 0 ? Math.round(totalAttention / attentionCount) : 0;
    const studentBadges = await this.getBadges(studentId);
    const quizAttemptsList = await this.getStudentQuizAttempts(studentId);

    const readingSessionsList = await db.select().from(readingSessions).where(eq(readingSessions.studentId, studentId));
    const readingCompleted = readingSessionsList.filter(rs => rs.completedAt).length;

    const { password: _, ...safeStudent } = student;

    return {
      student: safeStudent,
      sessionsTotal: classSessions.length,
      sessionsAttended: attendedCount,
      avgAttention,
      xp: student.xp,
      level: student.level,
      streakDays: student.streakDays,
      badges: studentBadges,
      quizAttempts: quizAttemptsList,
      readingCompleted,
    };
  }

  async getTeacherOverviewForAI(teacherId: string) {
    const teacherClasses = await this.getClasses(teacherId);
    const classOverviews = await Promise.all(teacherClasses.map(async (cls) => {
      const students = await this.getClassStudents(cls.id);
      const sessionList = await this.getSessions(cls.id);
      const completedSessions = sessionList.filter(s => s.avgAttention !== null);
      const avgAttention = completedSessions.length > 0
        ? Math.round(completedSessions.reduce((sum, s) => sum + (s.avgAttention || 0), 0) / completedSessions.length)
        : 0;
      const boredCount = sessionList.reduce((sum, s) => sum + (s.boredCount || 0), 0);

      const studentSummaries = students.map(s => ({
        name: s.name.split(" ")[0],
        xp: s.xp,
        level: s.level,
        streakDays: s.streakDays,
        learningStyle: s.learningStyle,
      }));

      const lowXpStudents = students.filter(s => s.xp < 200).map(s => s.name.split(" ")[0]);
      const topStudents = [...students].sort((a, b) => b.xp - a.xp).slice(0, 3).map(s => `${s.name.split(" ")[0]} (${s.xp} XP)`);

      return {
        className: cls.title,
        subject: cls.subject,
        studentCount: students.length,
        sessionCount: sessionList.length,
        avgAttention,
        boredCount,
        topStudents,
        lowXpStudents,
        students: studentSummaries,
      };
    }));

    return {
      totalClasses: teacherClasses.length,
      totalStudents: classOverviews.reduce((s, c) => s + c.studentCount, 0),
      totalSessions: classOverviews.reduce((s, c) => s + c.sessionCount, 0),
      classes: classOverviews,
    };
  }

  async createSubmission(data: { assignmentId: string; studentId: string; fileName: string; filePath: string; fileType: string; fileSize: number; extractedText?: string }) {
    const [sub] = await db.insert(assignmentSubmissions).values(data).returning();
    return sub;
  }

  async getSubmission(id: string) {
    const [sub] = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, id));
    return sub;
  }

  async getSubmissionsByAssignment(assignmentId: string) {
    const subs = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.assignmentId, assignmentId)).orderBy(desc(assignmentSubmissions.submittedAt));
    const withStudents = await Promise.all(subs.map(async (s) => {
      const student = await this.getUser(s.studentId);
      return { ...s, student };
    }));
    return withStudents;
  }

  async getStudentSubmission(assignmentId: string, studentId: string) {
    const [sub] = await db.select().from(assignmentSubmissions).where(
      and(eq(assignmentSubmissions.assignmentId, assignmentId), eq(assignmentSubmissions.studentId, studentId))
    );
    return sub;
  }

  async gradeSubmission(id: string, grade: number, feedback?: string) {
    const [sub] = await db.update(assignmentSubmissions).set({ grade, feedback, gradedAt: new Date() }).where(eq(assignmentSubmissions.id, id)).returning();
    return sub;
  }

  async updateSubmissionText(id: string, text: string) {
    await db.update(assignmentSubmissions).set({ extractedText: text }).where(eq(assignmentSubmissions.id, id));
  }

  async deleteSubmission(id: string) {
    await db.delete(assignmentSubmissions).where(eq(assignmentSubmissions.id, id));
  }

  async getConversations(userId: string) {
    const sent = await db.select().from(directMessages).where(eq(directMessages.senderId, userId));
    const received = await db.select().from(directMessages).where(eq(directMessages.receiverId, userId));
    const allMessages = [...sent, ...received];

    const otherUserIds = new Set<string>();
    for (const msg of allMessages) {
      const otherId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      otherUserIds.add(otherId);
    }

    const conversations: { user: User; lastMessage: DirectMessage; unreadCount: number }[] = [];
    for (const otherId of Array.from(otherUserIds)) {
      const user = await this.getUser(otherId);
      if (!user) continue;

      const msgs = allMessages
        .filter(m => m.senderId === otherId || m.receiverId === otherId)
        .sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bTime - aTime;
        });

      const lastMessage = msgs[0];
      if (!lastMessage) continue;

      const unreadCount = received.filter(m => m.senderId === otherId && !m.read).length;
      conversations.push({ user, lastMessage, unreadCount });
    }

    conversations.sort((a, b) => {
      const aTime = a.lastMessage.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const bTime = b.lastMessage.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return conversations;
  }

  async getMessages(userId: string, otherUserId: string) {
    const allMessages = await db.select().from(directMessages).where(
      sql`(${directMessages.senderId} = ${userId} AND ${directMessages.receiverId} = ${otherUserId}) OR (${directMessages.senderId} = ${otherUserId} AND ${directMessages.receiverId} = ${userId})`
    ).orderBy(directMessages.createdAt);
    return allMessages;
  }

  async sendMessage(senderId: string, receiverId: string, content: string) {
    const [msg] = await db.insert(directMessages).values({ senderId, receiverId, content }).returning();
    return msg;
  }

  async markMessagesRead(userId: string, fromUserId: string) {
    await db.update(directMessages).set({ read: true }).where(
      and(eq(directMessages.senderId, fromUserId), eq(directMessages.receiverId, userId), eq(directMessages.read, false))
    );
  }

  async getUnreadMessageCount(userId: string) {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(directMessages).where(
      and(eq(directMessages.receiverId, userId), eq(directMessages.read, false))
    );
    return result?.count || 0;
  }

  async areClassmates(userId1: string, userId2: string) {
    const classes1 = await db.select({ classId: classEnrollments.classId }).from(classEnrollments).where(eq(classEnrollments.studentId, userId1));
    const classes2 = await db.select({ classId: classEnrollments.classId }).from(classEnrollments).where(eq(classEnrollments.studentId, userId2));
    const classIds1 = new Set(classes1.map(c => c.classId));
    return classes2.some(c => classIds1.has(c.classId));
  }

  async getClassmates(userId: string) {
    const myClasses = await db.select({ classId: classEnrollments.classId }).from(classEnrollments).where(eq(classEnrollments.studentId, userId));
    const classmateIds = new Set<string>();
    for (const cls of myClasses) {
      const enrollments = await db.select({ studentId: classEnrollments.studentId }).from(classEnrollments).where(eq(classEnrollments.classId, cls.classId));
      for (const e of enrollments) {
        if (e.studentId !== userId) classmateIds.add(e.studentId);
      }
    }
    const classmates: User[] = [];
    for (const id of Array.from(classmateIds)) {
      const user = await this.getUser(id);
      if (user) classmates.push(user);
    }
    return classmates;
  }

  async getLeaderboard(classId: string) {
    const students = await this.getClassStudents(classId);
    const sorted = students.sort((a, b) => b.xp - a.xp);
    return sorted.map((user, idx) => ({ user, xp: user.xp, rank: idx + 1 }));
  }

  async getAdminStats() {
    const allStudents = await db.select().from(users).where(eq(users.role, "student"));
    const allTeachers = await db.select().from(users).where(eq(users.role, "teacher"));
    const allClasses = await db.select().from(classes);
    const allSessions = await db.select().from(sessionsTable);
    const allSubmissions = await db.select().from(assignmentSubmissions);
    const allQuizAttempts = await db.select().from(quizAttempts);

    const completedSessions = allSessions.filter(s => s.avgAttention !== null);
    const avgAttention = completedSessions.length > 0
      ? Math.round(completedSessions.reduce((sum, s) => sum + (s.avgAttention || 0), 0) / completedSessions.length)
      : 0;

    const topStudents = [...allStudents]
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 5)
      .map(s => ({ id: s.id, name: s.name, xp: s.xp, level: s.level }));

    const recentNotifs = await db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(10);
    const recentActivity = recentNotifs.map(n => ({
      type: n.type,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt,
    }));

    return {
      totalStudents: allStudents.length,
      totalTeachers: allTeachers.length,
      totalClasses: allClasses.length,
      totalSessions: allSessions.length,
      totalSubmissions: allSubmissions.length,
      totalQuizAttempts: allQuizAttempts.length,
      avgAttention,
      topStudents,
      recentActivity,
    };
  }
}

export const storage = new DatabaseStorage();

export async function seedDatabase() {
  try {
    const existing = await storage.getUserByUsername("teacher1");
    if (existing) return;

    const teacher = await storage.createUser({
      username: "teacher1",
      password: "password123",
      name: "Dr. Sarah Mitchell",
      email: "s.mitchell@university.edu",
      role: "teacher",
    });

    const teacher2 = await storage.createUser({
      username: "teacher2",
      password: "password123",
      name: "Prof. James Chen",
      email: "j.chen@university.edu",
      role: "teacher",
    });

    const admin = await storage.createUser({
      username: "admin",
      password: "password123",
      name: "Admin User",
      email: "admin@university.edu",
      role: "admin",
    });

    const studentData = [
      { username: "student1", name: "Alex Thompson", email: "a.thompson@student.edu", xp: 1240, level: 8, streakDays: 7, learningStyle: "visual" },
      { username: "student2", name: "Emma Rodriguez", email: "e.rodriguez@student.edu", xp: 980, level: 6, streakDays: 4, learningStyle: "reading" },
      { username: "student3", name: "Liam Patel", email: "l.patel@student.edu", xp: 1560, level: 10, streakDays: 12, learningStyle: "kinetic" },
      { username: "student4", name: "Olivia Kim", email: "o.kim@student.edu", xp: 720, level: 5, streakDays: 2, learningStyle: "auditory" },
      { username: "student5", name: "Noah Williams", email: "n.williams@student.edu", xp: 430, level: 3, streakDays: 1, learningStyle: "mixed" },
      { username: "student6", name: "Ava Johnson", email: "a.johnson@student.edu", xp: 1820, level: 12, streakDays: 15, learningStyle: "visual" },
    ];

    const students = await Promise.all(studentData.map(s =>
      storage.createUser({ ...s, password: "password123", role: "student", styleConfidence: 0.8 })
    ));

    const class1 = await storage.createClass({
      teacherId: teacher.id,
      title: "Advanced Mathematics",
      subject: "Mathematics",
      scheduleTime: "Mon/Wed/Fri 9:00 AM",
      gamificationEnabled: true,
      joinCode: "MATH101",
    });

    const class2 = await storage.createClass({
      teacherId: teacher.id,
      title: "Introduction to Physics",
      subject: "Physics",
      scheduleTime: "Tue/Thu 2:00 PM",
      gamificationEnabled: true,
      joinCode: "PHYS101",
    });

    const class3 = await storage.createClass({
      teacherId: teacher2.id,
      title: "World Literature",
      subject: "English",
      scheduleTime: "Mon/Wed 11:00 AM",
      gamificationEnabled: false,
      joinCode: "ENG201",
    });

    for (const student of students) {
      await storage.enrollStudent(class1.id, student.id);
    }
    await storage.enrollStudent(class2.id, students[0].id);
    await storage.enrollStudent(class2.id, students[1].id);
    await storage.enrollStudent(class2.id, students[2].id);
    await storage.enrollStudent(class3.id, students[3].id);
    await storage.enrollStudent(class3.id, students[4].id);

    const session1 = await storage.createSession({ classId: class1.id, teacherId: teacher.id, title: "Calculus - Derivatives" });
    await storage.updateSession(session1.id, {
      status: "ended",
      endedAt: new Date(Date.now() - 3600000),
      avgAttention: 76,
      peakAttention: 94,
      boredCount: 2,
    });

    const session2 = await storage.createSession({ classId: class1.id, teacherId: teacher.id, title: "Linear Algebra Introduction" });
    await storage.updateSession(session2.id, {
      status: "ended",
      endedAt: new Date(Date.now() - 86400000),
      avgAttention: 82,
      peakAttention: 97,
      boredCount: 1,
    });

    const session3 = await storage.createSession({ classId: class2.id, teacherId: teacher.id, title: "Newton's Laws of Motion" });
    await storage.updateSession(session3.id, {
      status: "ended",
      endedAt: new Date(Date.now() - 172800000),
      avgAttention: 71,
      peakAttention: 89,
      boredCount: 4,
    });

    const book1 = await storage.createBook({ title: "Calculus: Early Transcendentals", uploadedBy: teacher.id, subject: "Mathematics", totalPages: 284, tags: ["calculus", "derivatives", "integrals"], coverColor: "#2563EB" });
    const book2 = await storage.createBook({ title: "Fundamentals of Physics", uploadedBy: teacher.id, subject: "Physics", totalPages: 156, tags: ["mechanics", "waves", "thermodynamics"], coverColor: "#7C3AED" });
    const book3 = await storage.createBook({ title: "Linear Algebra Done Right", uploadedBy: teacher.id, subject: "Mathematics", totalPages: 210, tags: ["vectors", "matrices", "eigenvalues"], coverColor: "#0EA5E9" });
    const book4 = await storage.createBook({ title: "The Great Gatsby", uploadedBy: teacher2.id, subject: "English", totalPages: 95, tags: ["american literature", "symbolism"], coverColor: "#16A34A" });

    await storage.createAssignment({ bookId: book1.id, classId: class1.id, dueAt: new Date(Date.now() + 7 * 86400000), timerSeconds: 3600, allowSkip: true });
    await storage.createAssignment({ bookId: book3.id, classId: class1.id, dueAt: new Date(Date.now() + 14 * 86400000), timerSeconds: 2700, allowSkip: true });
    await storage.createAssignment({ bookId: book2.id, classId: class2.id, dueAt: new Date(Date.now() + 5 * 86400000), timerSeconds: 1800, allowSkip: false });
    await storage.createAssignment({ bookId: book4.id, classId: class3.id, dueAt: new Date(Date.now() + 3 * 86400000), timerSeconds: 1200, allowSkip: true });

    const emotions = ["neutral", "happy", "bored", "confused", "focused"];
    for (const student of students) {
      for (let i = 0; i < 10; i++) {
        await storage.addAttentionScore({
          sessionId: session1.id,
          studentId: student.id,
          score: 55 + Math.floor(Math.random() * 40),
          emotion: emotions[Math.floor(Math.random() * emotions.length)],
        });
      }
    }

    const badgeTypes = [
      { type: "first_chapter", label: "First Chapter" },
      { type: "week_streak", label: "7-Day Streak" },
      { type: "perfect_quiz", label: "Perfect Quiz" },
      { type: "speed_reader", label: "Speed Reader" },
    ];

    await storage.awardBadge({ userId: students[0].id, badgeType: "first_chapter", label: "First Chapter" });
    await storage.awardBadge({ userId: students[0].id, badgeType: "week_streak", label: "7-Day Streak" });
    await storage.awardBadge({ userId: students[0].id, badgeType: "perfect_quiz", label: "Perfect Quiz" });
    await storage.awardBadge({ userId: students[2].id, badgeType: "first_chapter", label: "First Chapter" });
    await storage.awardBadge({ userId: students[2].id, badgeType: "speed_reader", label: "Speed Reader" });
    await storage.awardBadge({ userId: students[2].id, badgeType: "week_streak", label: "7-Day Streak" });
    await storage.awardBadge({ userId: students[5].id, badgeType: "first_chapter", label: "First Chapter" });
    await storage.awardBadge({ userId: students[5].id, badgeType: "perfect_quiz", label: "Perfect Quiz" });

    const notifTargets = [teacher.id, students[0].id, students[1].id, students[2].id];
    const notifData = [
      { userId: teacher.id, type: "session_alert", title: "Boredom Alert", body: "3 students in Advanced Mathematics appear disengaged. Consider switching content format." },
      { userId: teacher.id, type: "report_ready", title: "Weekly Reports Ready", body: "Parent reports for Advanced Mathematics are ready for review." },
      { userId: students[0].id, type: "badge_earned", title: "Badge Earned!", body: "You earned the '7-Day Streak' badge. Keep it up!" },
      { userId: students[0].id, type: "class_starting", title: "Class Starting Soon", body: "Advanced Mathematics starts in 15 minutes. Join the session!" },
      { userId: students[1].id, type: "assignment_due", title: "Assignment Due Soon", body: "Calculus: Early Transcendentals is due in 24 hours." },
    ];

    await Promise.all(notifData.map(n => storage.createNotification(n)));

    await storage.createQuiz({
      classId: class1.id,
      title: "Derivatives Fundamentals",
      questions: [
        { question: "What is the derivative of x²?", options: ["x", "2x", "2", "x²/2"], correctIndex: 1 },
        { question: "The derivative of a constant is:", options: ["1", "The constant itself", "0", "Undefined"], correctIndex: 2 },
        { question: "What is d/dx(sin x)?", options: ["cos x", "-cos x", "sin x", "-sin x"], correctIndex: 0 },
        { question: "The chain rule is used for:", options: ["Addition of functions", "Composite functions", "Constant functions", "Linear functions"], correctIndex: 1 },
        { question: "What is the derivative of eˣ?", options: ["xeˣ⁻¹", "eˣ", "ln(x)", "1/x"], correctIndex: 1 },
      ],
      timeLimitSeconds: 300,
      antiCheatEnabled: true,
      createdBy: teacher.id,
    });

    await storage.createQuiz({
      classId: class1.id,
      title: "Linear Algebra Basics",
      questions: [
        { question: "What is the identity matrix?", options: ["All zeros", "All ones", "Diagonal ones, rest zeros", "Random values"], correctIndex: 2 },
        { question: "The determinant of a 2x2 matrix [[a,b],[c,d]] is:", options: ["ad+bc", "ad-bc", "ac-bd", "ac+bd"], correctIndex: 1 },
        { question: "A matrix with more rows than columns is called:", options: ["Square", "Tall", "Wide", "Singular"], correctIndex: 1 },
      ],
      timeLimitSeconds: 180,
      antiCheatEnabled: false,
      createdBy: teacher.id,
    });

    await storage.createQuiz({
      classId: class2.id,
      title: "Newton's Laws Quiz",
      questions: [
        { question: "Newton's first law is also known as:", options: ["Law of Acceleration", "Law of Inertia", "Law of Reaction", "Law of Gravity"], correctIndex: 1 },
        { question: "F = ma represents Newton's:", options: ["First law", "Second law", "Third law", "Law of gravitation"], correctIndex: 1 },
        { question: "For every action there is an equal and opposite:", options: ["Force", "Reaction", "Acceleration", "Velocity"], correctIndex: 1 },
        { question: "What is the SI unit of force?", options: ["Joule", "Watt", "Newton", "Pascal"], correctIndex: 2 },
      ],
      timeLimitSeconds: 240,
      antiCheatEnabled: true,
      createdBy: teacher.id,
    });

    console.log("Database seeded successfully");
  } catch (err) {
    console.error("Seed error:", err);
  }
}
