import { Server as SocketIOServer } from "socket.io";
import type { Server } from "http";
import { storage } from "./storage";
import { log } from "./index";

interface AttentionPayload {
  sessionId: string;
  score: number;
  emotion: string;
}

interface StudentSocket {
  userId: string;
  userName: string;
  sessionId: string;
}

const connectedStudents = new Map<string, StudentSocket>();

function getUniqueStudentsInSession(sessionId: string): { id: string; name: string }[] {
  const seen = new Set<string>();
  const result: { id: string; name: string }[] = [];
  connectedStudents.forEach((s) => {
    if (s.sessionId === sessionId && !seen.has(s.userId)) {
      seen.add(s.userId);
      result.push({ id: s.userId, name: s.userName });
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
      } catch (err) {
        log(`Failed to persist attention score: ${err}`, "socket.io");
      }
    });

    socket.on("student:peer-id", (peerId: string) => {
      if (userRole !== "student") return;
      const studentInfo = connectedStudents.get(socket.id);
      if (!studentInfo) return;

      io.to(`teacher:${studentInfo.sessionId}`).emit("peer:student-ready", {
        studentId: userId,
        peerId
      });
      log(`Student ${userName} sent peerId ${peerId} for session ${studentInfo.sessionId}`, "socket.io");
    });

    socket.on("teacher:end-session", async (sessionId: string) => {
      if (userRole !== "teacher") return;

      const session_ = await storage.getSession(sessionId);
      if (!session_ || session_.teacherId !== userId) return;

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
