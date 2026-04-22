import { Server as SocketIOServer } from "socket.io";
import type { Server } from "http";
import { storage } from "./storage";
import { log } from "./index";
import { analyzeSessionState, type SessionState, type TeacherIntervention } from "./agent";

interface AttentionPayload {
  sessionId: string;
  score: number;
  emotion: string;
}

interface StudentSocket {
  userId: string;
  userName: string;
  sessionId: string;
  peerId?: string;
}

const connectedStudents = new Map<string, StudentSocket>();
const activeSessionIntervals = new Map<string, NodeJS.Timeout>();
const sessionMetrics = new Map<string, { lastScores: number[], emotions: string[] }>();

function getUniqueStudentsInSession(sessionId: string): { id: string; name: string; peerId?: string }[] {
  const seen = new Set<string>();
  const result: { id: string; name: string; peerId?: string }[] = [];
  connectedStudents.forEach((s) => {
    if (s.sessionId === sessionId && !seen.has(s.userId)) {
      seen.add(s.userId);
      result.push({ id: s.userId, name: s.userName, peerId: s.peerId });
    }
  });
  return result;
}

function isStudentAlreadyConnected(sessionId: string, userId: string): boolean {
  let found = false;
  connectedStudents.forEach((s) => {
    if (s.sessionId === sessionId && s.userId === userId) found = true;
  });
  return found;
}

export function setupSocketIO(httpServer: Server, sessionMiddleware: any): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
    path: "/socket.io",
  });

  io.use((socket, next) => {
    sessionMiddleware(socket.request as any, {} as any, next);
  });

  io.use(async (socket, next) => {
    const session = (socket.request as any).session;
    if (!session?.userId) {
      return next(new Error("Unauthorized"));
    }
    const user = await storage.getUser(session.userId);
    if (!user) {
      return next(new Error("User not found"));
    }
    (socket as any).userId = user.id;
    (socket as any).userName = user.name;
    (socket as any).userRole = user.role;
    next();
  });

  io.on("connection", (socket) => {
    const userId = (socket as any).userId;
    const userName = (socket as any).userName;
    const userRole = (socket as any).userRole;
    log(`Socket connected: ${userName} (${userRole})`, "socket.io");

    socket.on("teacher:join-session", async (sessionId: string) => {
      if (userRole !== "teacher") return;

      const session_ = await storage.getSession(sessionId);
      if (!session_ || session_.teacherId !== userId) {
        socket.emit("session:error", "Session not found or not authorized");
        return;
      }

      socket.join(`session:${sessionId}`);
      socket.join(`teacher:${sessionId}`);
      log(`Teacher ${userName} joined session room ${sessionId}`, "socket.io");

      socket.emit("session:current-students", getUniqueStudentsInSession(sessionId));

      // Start Agentic Co-Pilot Autonomous Monitoring
      if (!activeSessionIntervals.has(sessionId)) {
        const interval = setInterval(async () => {
          const metrics = sessionMetrics.get(sessionId);
          if (!metrics || metrics.lastScores.length === 0) return;

          const avgAttention = Math.round(metrics.lastScores.reduce((a, b) => a + b, 0) / metrics.lastScores.length);
          const emotionCounts = metrics.emotions.reduce((acc, e) => {
            acc[e] = (acc[e] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          const dominantEmotion = Object.keys(emotionCounts).reduce((a, b) => emotionCounts[a] > emotionCounts[b] ? a : b);

          const teacherSession = await storage.getSession(sessionId);
          const class_ = teacherSession ? await storage.getClass(teacherSession.classId) : null;

          const intervention = await analyzeSessionState({
            classTitle: class_?.title || "Class",
            subject: class_?.subject || "Subject",
            avgAttention,
            dominantEmotion,
            recentTranscript: teacherSession?.transcript || "",
            studentCount: getUniqueStudentsInSession(sessionId).length
          });

          if (intervention) {
            io.to(`teacher:${sessionId}`).emit("copilot:suggestion", intervention);
            log(`Agentic Co-Pilot issued ${intervention.type} for session ${sessionId}`, "socket.io");
          }
        }, 45000); // Analyze every 45s
        activeSessionIntervals.set(sessionId, interval);
      }
    });

    socket.on("student:join-session", async (sessionId: string) => {
      if (userRole !== "student") return;

      const session_ = await storage.getSession(sessionId);
      if (!session_ || session_.status !== "live") {
        socket.emit("session:error", "Session not found or not live");
        return;
      }

      const enrolled = await storage.isEnrolled(session_.classId, userId);
      if (!enrolled) {
        socket.emit("session:error", "You are not enrolled in this class");
        return;
      }

      const alreadyConnected = isStudentAlreadyConnected(sessionId, userId);

      socket.join(`session:${sessionId}`);
      connectedStudents.set(socket.id, { userId, userName, sessionId });

      log(`Student ${userName} joined session ${sessionId}`, "socket.io");

      if (!alreadyConnected) {
        io.to(`teacher:${sessionId}`).emit("student:joined", {
          id: userId,
          name: userName,
        });
      }

      socket.emit("session:joined", { sessionId, title: session_.title });
    });

    socket.on("student:attention", async (data: AttentionPayload) => {
      if (userRole !== "student") return;
      const studentInfo = connectedStudents.get(socket.id);
      if (!studentInfo || studentInfo.sessionId !== data.sessionId) return;

      const score = Math.max(0, Math.min(100, Math.round(data.score)));
      const emotion = data.emotion || "neutral";

      io.to(`teacher:${data.sessionId}`).emit("attention:update", {
        studentId: userId,
        studentName: userName,
        score,
        emotion,
        timestamp: Date.now(),
      });

      try {
        await storage.addAttentionScore({
          sessionId: data.sessionId,
          studentId: userId,
          score,
          emotion,
        });

        // Track metrics for Agentic AI
        if (!sessionMetrics.has(data.sessionId)) {
          sessionMetrics.set(data.sessionId, { lastScores: [], emotions: [] });
        }
        const metrics = sessionMetrics.get(data.sessionId)!;
        metrics.lastScores.push(score);
        metrics.emotions.push(emotion);
        if (metrics.lastScores.length > 50) metrics.lastScores.shift();
        if (metrics.emotions.length > 50) metrics.emotions.shift();

      } catch (err) {
        log(`Failed to persist attention score: ${err}`, "socket.io");
      }
    });

    socket.on("student:peer-id", (peerId: string) => {
      if (userRole !== "student") return;
      const studentInfo = connectedStudents.get(socket.id);
      if (!studentInfo) return;

      studentInfo.peerId = peerId;
      io.to(`teacher:${studentInfo.sessionId}`).emit("peer:student-ready", {
        studentId: userId,
        peerId
      });
      log(`Student ${userName} registered peerId ${peerId} for session ${studentInfo.sessionId}`, "socket.io");
    });

    socket.on("teacher:request-peer-ids", (sessionId: string) => {
      if (userRole !== "teacher") return;
      log(`Teacher ${userName} requested all peer IDs for session ${sessionId}`, "socket.io");
      io.to(`session:${sessionId}`).emit("peer:request-id");
    });

    socket.on("teacher:end-session", async (sessionId: string) => {
      if (userRole !== "teacher") return;

      const session_ = await storage.getSession(sessionId);
      if (!session_ || session_.teacherId !== userId) return;

      const interval = activeSessionIntervals.get(sessionId);
      if (interval) {
        clearInterval(interval);
        activeSessionIntervals.delete(sessionId);
      }
      sessionMetrics.delete(sessionId);

      io.to(`session:${sessionId}`).emit("session:ended", { sessionId });
      log(`Teacher ended session ${sessionId} via socket`, "socket.io");
    });

    socket.on("disconnect", () => {
      const studentInfo = connectedStudents.get(socket.id);
      if (studentInfo) {
        connectedStudents.delete(socket.id);
        const stillConnected = isStudentAlreadyConnected(studentInfo.sessionId, studentInfo.userId);
        if (!stillConnected) {
          io.to(`teacher:${studentInfo.sessionId}`).emit("student:left", {
            id: studentInfo.userId,
            name: studentInfo.userName,
          });
        }
        log(`Student ${studentInfo.userName} disconnected from session ${studentInfo.sessionId}`, "socket.io");
      } else {
        log(`Socket disconnected: ${userName} (${userRole})`, "socket.io");
      }
    });
  });

  return io;
}
