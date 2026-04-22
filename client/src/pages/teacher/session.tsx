import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getSocket, disconnectSocket } from "@/lib/socket";
import { useAuth } from "@/hooks/use-auth";
import {
  Square, Users, Brain, AlertTriangle, Eye, Radio, Wifi, WifiOff,
  TrendingUp, SmilePlus, Frown, Meh, HelpCircle, Zap, Clock,
  Video, Monitor, ChevronRight, ScreenShare, Camera, Mic, MicOff,
  Bot
} from "lucide-react";
import Peer from "peerjs";
import { cn } from "@/lib/utils";

const emotionConfig: Record<string, { icon: any; color: string; bg: string; border: string; ring: string }> = {
  focused: { icon: Eye, color: "text-emerald-400", bg: "bg-emerald-500/20", border: "border-emerald-500/40", ring: "#16A34A" },
  neutral: { icon: Meh, color: "text-blue-400", bg: "bg-blue-500/20", border: "border-blue-500/40", ring: "#3B82F6" },
  happy: { icon: SmilePlus, color: "text-amber-400", bg: "bg-amber-500/20", border: "border-amber-500/40", ring: "#D97706" },
  confused: { icon: HelpCircle, color: "text-orange-400", bg: "bg-orange-500/20", border: "border-orange-500/40", ring: "#EA580C" },
  bored: { icon: Frown, color: "text-red-400", bg: "bg-red-500/20", border: "border-red-500/40", ring: "#DC2626" },
  distracted: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/20", border: "border-red-500/40", ring: "#DC2626" },
};

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function AttentionRing({ score, size = 44 }: { score: number; size?: number }) {
  const radius = size / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? "#16A34A" : score >= 50 ? "#D97706" : "#DC2626";

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="#334155" strokeWidth="3" fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        stroke={color} strokeWidth="3" fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

interface StudentState {
  id: string;
  name: string;
  email: string;
  score: number;
  emotion: string;
  trend: number[];
  connected: boolean;
  lastUpdate: number;
  peerId?: string;
}

export default function TeacherSession() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [attentionHistory, setAttentionHistory] = useState<{ t: number; avg: number }[]>([]);
  const [studentStates, setStudentStates] = useState<StudentState[]>([]);
  const [copilotSuggestions, setCopilotSuggestions] = useState<any[]>([]);
  const [isCopilotEnabled, setIsCopilotEnabled] = useState(true);
  const [isLive, setIsLive] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef(0);
  const studentStatesRef = useRef<StudentState[]>([]);
  const timerRef = useRef<number | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const callsRef = useRef<Map<string, any>>(new Map());
  const [isMuted, setIsMuted] = useState(true);



  const toggleMute = () => {
    if (streamRef.current) {
      const newState = !isMuted;
      streamRef.current.getAudioTracks().forEach(t => t.enabled = !newState);
      setIsMuted(newState);
    }
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      setStream(null);
      streamRef.current = null;
    }
    callsRef.current.forEach(call => call.close());
    callsRef.current.clear();
  };

  const startStream = async (type: "camera" | "screen") => {
    try {
      stopStream();

      const callStudents = (streamToUse: MediaStream) => {
        studentStatesRef.current.forEach(student => {
          if (student.peerId && student.connected && !callsRef.current.has(student.peerId)) {
            const call = peerRef.current!.call(student.peerId, streamToUse);
            callsRef.current.set(student.peerId, call);
          }
        });
      };

      const finalStream = type === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        : await (async () => {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
              video: { displaySurface: "monitor" }, 
              audio: true 
            });
            try {
              // Also capture microphone to merge with screen share
              const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
              const tracks = [...screenStream.getVideoTracks(), ...micStream.getAudioTracks()];
              return new MediaStream(tracks);
            } catch (micErr) {
              console.warn("Could not capture microphone for screen share", micErr);
              return screenStream;
            }
          })();

      setIsMuted(false);
      setStream(finalStream);
      streamRef.current = finalStream;

      if (!peerRef.current) {
        peerRef.current = new Peer(undefined, {
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ]
          }
        });
        peerRef.current.on('open', () => callStudents(finalStream));
      } else {
        callStudents(finalStream);
      }



      mediaStream.getVideoTracks()[0].onended = () => {
        stopStream();
      };
    } catch (e) {
      toast({ title: "Failed to start stream", variant: "destructive" });
    }
  };

  useEffect(() => {
      const socket = getSocket();
      socket.on("copilot:suggestion", (suggestion: any) => {
        setCopilotSuggestions(prev => [
          { ...suggestion, id: Date.now(), timestamp: new Date() },
          ...prev.slice(0, 4)
        ]);
        toast({
          title: "AI Co-Pilot Suggestion",
          description: suggestion.message,
          variant: suggestion.priority === "high" ? "destructive" : "default"
        });
      });

      return () => {
      stopStream();
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  const { data: session, isLoading: sessionLoading } = useQuery<any>({ queryKey: ["/api/sessions", id] });
  const { data: classData } = useQuery<any>({
    queryKey: ["/api/classes", session?.classId],
    enabled: !!session?.classId,
  });

  const endSession = useMutation({
    mutationFn: (sessionId: string) => apiRequest("PUT", `/api/sessions/${sessionId}`, {
      status: "ended",
      endedAt: new Date().toISOString(),
      ...(attentionHistory.length > 0
        ? { avgAttention: Math.round(attentionHistory.reduce((s, h) => s + h.avg, 0) / attentionHistory.length) }
        : {}),
    }),
    onSuccess: () => {
      const socket = getSocket();
      socket.emit("teacher:end-session", id);
      qc.invalidateQueries({ queryKey: ["/api/sessions", id] });
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
      setIsLive(false);
      if (timerRef.current) clearInterval(timerRef.current);
      toast({ title: "Session ended", description: "Downloading attendance report..." });

      // Auto download attendance report
      setTimeout(() => {
        window.open(`/api/reports/session/${id}/attendance/pdf`, '_blank');
      }, 1000);
    },
    onError: (error) => {
      toast({ title: "Failed to end session", description: String(error), variant: "destructive" });
    }
  });



  useEffect(() => {
    if (!isLive) return;
    timerRef.current = window.setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isLive]);

  useEffect(() => {
    if (!classData?.students?.length) return;
    const students: StudentState[] = classData.students.map((s: any) => ({
      id: s.id, name: s.name, email: s.email, score: 0,
      emotion: "neutral", trend: [], connected: false, lastUpdate: 0,
    }));
    setStudentStates(students);
    studentStatesRef.current = students;
  }, [classData]);

  useEffect(() => { studentStatesRef.current = studentStates; }, [studentStates]);

  useEffect(() => {
    const socket = getSocket();

    socket.on("connect", () => {
      setSocketConnected(true);
      socket.emit("teacher:join-session", id);
    });

    socket.on("session:current-students", (students: { id: string; name: string; peerId?: string }[]) => {
      setStudentStates(prev => prev.map(s => {
        const found = students.find(cs => cs.id === s.id);
        return {
          ...s,
          connected: !!found,
          peerId: found?.peerId || s.peerId
        };
      }));
      // If any connected student is missing a peerId, request all students to send their IDs
      if (students.some(s => !s.peerId)) {
        socket.emit("teacher:request-peer-ids", id);
      }
    });

    socket.on("student:joined", (data: { id: string; name: string }) => {
      setStudentStates(prev => {
        const exists = prev.find(s => s.id === data.id);
        if (exists) return prev.map(s => s.id === data.id ? { ...s, connected: true } : s);
        return [...prev, {
          id: data.id, name: data.name, email: "", score: 0,
          emotion: "neutral", trend: [], connected: true, lastUpdate: Date.now(),
        }];
      });
      toast({ title: "Student joined", description: `${data.name} connected` });
    });

    socket.on("student:left", (data: { id: string }) => {
      setStudentStates(prev => prev.map(s => s.id === data.id ? { ...s, connected: false } : s));
    });

    socket.on("attention:update", (data: {
      studentId: string; studentName: string; score: number; emotion: string; timestamp: number;
    }) => {
      setStudentStates(prev => prev.map(s => {
        if (s.id !== data.studentId) return s;
        return { ...s, score: data.score, emotion: data.emotion, lastUpdate: data.timestamp, trend: [...s.trend.slice(-7), data.score] };
      }));

      tickRef.current += 1;
      setAttentionHistory(prev => {
        const latest = studentStatesRef.current;
        const connected = latest.filter(s => s.connected);
        const scores = connected.map(s => s.id === data.studentId ? data.score : s.score).filter(s => s > 0);
        if (scores.length === 0) return prev;
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        return [...prev.slice(-29), { t: tickRef.current, avg }];
      });
    });

    socket.on("peer:student-ready", ({ studentId, peerId }) => {
      setStudentStates(prev => prev.map(s => s.id === studentId ? { ...s, peerId } : s));
      if (streamRef.current && peerRef.current) {
        const call = peerRef.current.call(peerId, streamRef.current);
        callsRef.current.set(peerId, call);
      }
    });

    socket.on("disconnect", () => setSocketConnected(false));

    if (socket.connected) {
      setSocketConnected(true);
      socket.emit("teacher:join-session", id);
    }

    return () => {
      socket.off("connect"); socket.off("session:current-students");
      socket.off("student:joined"); socket.off("student:left");
      socket.off("attention:update"); socket.off("disconnect");
      disconnectSocket();
    };
  }, [id]);

  const connectedStudents = studentStates.filter(s => s.connected);
  const activeStudents = connectedStudents.filter(s => s.score > 0);
  const avgAttention = activeStudents.length > 0
    ? Math.round(activeStudents.reduce((s, st) => s + st.score, 0) / activeStudents.length) : 0;
  const boredStudents = connectedStudents.filter(s => s.emotion === "bored" || s.emotion === "distracted");
  const totalStudents = studentStates.length;

  if (sessionLoading) {
    return (
      <div>
        <PageHeader title="Loading session..." />
        <div className="p-6 space-y-4"><Skeleton className="h-96 rounded-xl" /></div>
      </div>
    );
  }

  const sessionStatus = session?.status || "live";
  const displayLive = sessionStatus === "live" && isLive;

  if (!displayLive) {
    return (
      <div>
        <PageHeader title={session?.title || "Session"} subtitle="Session has ended" />
        <div className="p-6">
          <Card>
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                <WifiOff className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Session Ended</h3>
              <p className="text-sm text-muted-foreground mb-4">Session data has been saved to analytics</p>
              <Button onClick={() => setLocation("/teacher/analytics")} data-testid="button-view-analytics">
                View Analytics
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh)] flex flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-background flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-bold text-foreground truncate max-w-[200px]" data-testid="text-session-title">
              {session?.title || "Live Session"}
            </h1>
          </div>
          <span className="text-xs text-muted-foreground hidden sm:inline">{classData?.title}</span>
          <div className="flex items-center gap-2 ml-4">
            <Bot className={cn("w-4 h-4", isCopilotEnabled ? "text-primary animate-pulse" : "text-muted-foreground")} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Agentic Co-Pilot</span>
            <div 
              className={cn(
                "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
                isCopilotEnabled ? "bg-primary" : "bg-muted"
              )}
              onClick={() => setIsCopilotEnabled(!isCopilotEnabled)}
            >
              <div className={cn(
                "absolute top-1 w-2 h-2 rounded-full bg-white transition-all",
                isCopilotEnabled ? "left-5" : "left-1"
              )} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            className={cn("border-0 text-xs", socketConnected ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}
            data-testid="badge-socket-status"
          >
            {socketConnected ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
            {socketConnected ? "WebSocket Live" : "Reconnecting..."}
          </Badge>
          <Button
            size="sm" variant="destructive"
            onClick={() => endSession.mutate(id)} disabled={endSession.isPending}
            data-testid="button-end-session"
          >
            <Square className="w-3.5 h-3.5 mr-1.5" /> End Session
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative bg-slate-900 flex items-center justify-center overflow-hidden">
            {/* Agentic Co-Pilot Sidebar */}
            {isCopilotEnabled && copilotSuggestions.length > 0 && (
              <div className="absolute right-4 top-16 bottom-4 w-72 z-30 flex flex-col gap-3 pointer-events-none">
                <div className="flex-1 overflow-y-auto pr-2 space-y-3 pointer-events-auto custom-scrollbar">
                  {copilotSuggestions.map((suggestion) => (
                    <div 
                      key={suggestion.id}
                      className={cn(
                        "rounded-2xl p-4 shadow-xl border backdrop-blur-md animate-in slide-in-from-right-8 duration-500",
                        suggestion.priority === "high" 
                          ? "bg-red-500/90 border-red-400 text-white" 
                          : "bg-white/95 border-slate-200 text-slate-800"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Bot className={cn("w-4 h-4", suggestion.priority === "high" ? "text-white" : "text-primary")} />
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                          {suggestion.type.replace('_', ' ')}
                        </span>
                        <span className="ml-auto text-[9px] opacity-60">
                          {suggestion.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs font-semibold leading-relaxed mb-3">{suggestion.message}</p>
                      {suggestion.suggestedAction && (
                        <Button 
                          size="sm" 
                          variant={suggestion.priority === "high" ? "secondary" : "outline"} 
                          className="w-full h-7 text-[10px] font-bold rounded-lg"
                        >
                          {suggestion.suggestedAction}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-sm">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-semibold text-white" data-testid="text-session-live">LIVE</span>
                <span className="text-xs text-white/70 font-mono">{formatDuration(elapsed)}</span>
              </div>
            </div>

            <div className="absolute top-4 right-4 z-10">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-sm">
                <Users className="w-3.5 h-3.5 text-white/70" />
                <span className="text-xs font-semibold text-white" data-testid="text-connected-count">
                  {connectedStudents.length}/{totalStudents}
                </span>
              </div>
            </div>

            {stream ? (
              <div className="flex flex-col items-center gap-4 w-full h-[60vh] z-10 px-6">
                <video
                  ref={(v) => { if (v && !v.srcObject) v.srcObject = stream; }}
                  autoPlay muted playsInline
                  className="w-full h-full object-contain rounded-2xl bg-black shadow-2xl"
                />



                <div className="flex gap-2">
                  <Button size="sm" onClick={toggleMute} variant={isMuted ? "destructive" : "secondary"}>
                    {isMuted ? <MicOff className="w-4 h-4 mr-1.5" /> : <Mic className="w-4 h-4 mr-1.5" />}
                    {isMuted ? "Unmute" : "Mute"}
                  </Button>
                  <Button size="sm" onClick={stopStream} variant="destructive">
                    <Square className="w-4 h-4 mr-1.5" /> Stop Broadcasting
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 z-10">
                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center shadow-2xl shadow-blue-500/20">
                  <span className="text-4xl font-bold text-white">{user ? getInitials(user.name) : "T"}</span>
                </div>
                <div className="text-center">
                  <p className="text-white font-semibold text-lg">{user?.name || "Teacher"}</p>
                  <p className="text-white/50 text-sm">{classData?.title} — {classData?.subject}</p>
                  <div className="flex gap-2 justify-center mt-5">
                    <Button size="sm" onClick={() => startStream('camera')} className="bg-[#2563EB] text-white hover:bg-blue-600">
                      <Camera className="w-4 h-4 mr-2" /> Share Camera
                    </Button>
                    <Button size="sm" onClick={() => startStream('screen')} variant="secondary" className="bg-white hover:bg-slate-100 text-black">
                      <ScreenShare className="w-4 h-4 mr-2" /> Share Screen
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-12">
              <div className="grid grid-cols-4 gap-3 max-w-lg mx-auto">
                <div className="text-center">
                  <p className="text-xs text-white/50 mb-0.5">Avg Attention</p>
                  <p className={cn("text-xl font-bold font-mono",
                    avgAttention >= 75 ? "text-emerald-400" : avgAttention >= 50 ? "text-amber-400" : "text-red-400"
                  )} data-testid="text-avg-attention">{avgAttention}%</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-white/50 mb-0.5">Students Live</p>
                  <p className="text-xl font-bold font-mono text-blue-400">
                    {connectedStudents.length}/{totalStudents}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-white/50 mb-0.5">Bored Alert</p>
                  <p className={cn("text-xl font-bold font-mono", boredStudents.length > 0 ? "text-red-400" : "text-emerald-400")}
                    data-testid="text-disengaged-count">
                    {boredStudents.length}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-white/50 mb-0.5">Duration</p>
                  <p className="text-xl font-bold font-mono text-white">{formatDuration(elapsed)}</p>
                </div>
              </div>
            </div>
          </div>

          {boredStudents.length > 0 && (
            <div className="flex-shrink-0 px-4 py-3 bg-red-50 border-t border-red-100">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-700">
                    Boredom Detected — {boredStudents.length} Student{boredStudents.length !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-red-500 mt-0.5 truncate">
                    {boredStudents.map(s => s.name.split(" ")[0]).join(", ")} show disengagement
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-80 xl:w-96 border-l bg-background flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-4 py-3 border-b flex-shrink-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Student Feed</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {studentStates.length === 0 ? (
              <div className="p-6 text-center">
                <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No students yet</p>
              </div>
            ) : (
              <div className="p-3 space-y-2.5">
                {studentStates
                  .sort((a, b) => {
                    if (a.connected !== b.connected) return a.connected ? -1 : 1;
                    return b.score - a.score;
                  })
                  .map(student => {
                    const score = Math.round(student.score);
                    const emo = emotionConfig[student.emotion] || emotionConfig.neutral;
                    const EmotionIcon = emo.icon;
                    const isBored = student.emotion === "bored" || student.emotion === "distracted";

                    return (
                      <div
                        key={student.id}
                        data-testid={`student-feed-${student.id}`}
                        className={cn(
                          "rounded-xl border p-3 transition-all",
                          !student.connected ? "bg-muted/30 border-border opacity-60" :
                            isBored ? "bg-red-50 border-red-200 ring-1 ring-red-200" :
                              "bg-card border-border"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative flex-shrink-0">
                            <Avatar className="w-10 h-10 border-2" style={{
                              borderColor: student.connected && score > 0
                                ? (score >= 75 ? "#16A34A" : score >= 50 ? "#D97706" : "#DC2626")
                                : "#E2E8F0"
                            }}>
                              <AvatarFallback className={cn(
                                "text-xs font-bold",
                                student.connected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                              )}>
                                {getInitials(student.name)}
                              </AvatarFallback>
                            </Avatar>
                            {student.connected && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{student.name}</p>
                            <div className="flex items-center gap-1.5">
                              {student.connected ? (
                                <>
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span className="text-[11px] text-emerald-600">online</span>
                                </>
                              ) : (
                                <>
                                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                                  <span className="text-[11px] text-muted-foreground">offline</span>
                                </>
                              )}
                            </div>
                          </div>

                          {student.connected && score > 0 && (
                            <div className="flex-shrink-0 relative">
                              <AttentionRing score={score} size={44} />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[11px] font-bold font-mono" style={{
                                  color: score >= 75 ? "#16A34A" : score >= 50 ? "#D97706" : "#DC2626"
                                }}>{score}%</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {student.connected && score > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium flex-1",
                              isBored ? "bg-red-100 text-red-700" :
                                student.emotion === "focused" ? "bg-emerald-100 text-emerald-700" :
                                  student.emotion === "happy" ? "bg-amber-100 text-amber-700" :
                                    student.emotion === "confused" ? "bg-orange-100 text-orange-700" :
                                      "bg-blue-100 text-blue-700"
                            )}>
                              <EmotionIcon className="w-3 h-3" />
                              <span className="capitalize">{student.emotion}</span>
                            </div>
                            {isBored && (
                              <Badge className="text-[10px] bg-red-100 text-red-700 border-0 px-2 py-0.5">
                                <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Alert
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
