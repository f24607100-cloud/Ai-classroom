import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getSocket, disconnectSocket } from "@/lib/socket";
import { FaceMonitor, CameraConsentDialog } from "@/components/face-monitor";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  Radio, Eye, Brain, Wifi, WifiOff, TrendingUp,
  SmilePlus, Frown, Meh, HelpCircle, AlertTriangle, Zap, Camera, Bot
} from "lucide-react";
import Peer from "peerjs";
import { cn } from "@/lib/utils";

export default function StudentSession() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [currentScore, setCurrentScore] = useState(75);
  const [currentEmotion, setCurrentEmotion] = useState("neutral");
  const [scoreHistory, setScoreHistory] = useState<{ t: number; score: number }[]>([]);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [cameraConsent, setCameraConsent] = useState<boolean | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraWorking, setCameraWorking] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const tickRef = useRef(0);

  const { data: session, isLoading } = useQuery<any>({ queryKey: ["/api/sessions", id] });

  useEffect(() => {
    peerRef.current = new Peer(undefined, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });
    
    peerRef.current.on('call', (call) => {
      console.log("Receiving call from teacher...");
      call.answer();
      call.on('stream', (stream) => {
        console.log("Received stream from teacher", stream.getTracks());
        setRemoteStream(stream);
      });
    });

    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("student:join-session", id);
    });

    socket.on("session:joined", (data: { sessionId: string; title: string }) => {
      setJoined(true);
      setSessionTitle(data.title || "Live Session");
      toast({ title: "Connected!", description: "You joined the live session" });

      if (peerRef.current?.id) {
        socket.emit("student:peer-id", peerRef.current.id);
      } else if (peerRef.current) {
        peerRef.current.once("open", (id) => socket.emit("student:peer-id", id));
      }
    });

    socket.on("session:error", (msg: string) => {
      toast({ title: "Error", description: msg, variant: "destructive" });
    });

    socket.on("session:ended", () => {
      setSessionEnded(true);
      setJoined(false);
      setCameraActive(false);
      toast({ title: "Session Ended", description: "The teacher has ended this session" });
    });

    socket.on("peer:request-id", () => {
      if (peerRef.current?.id) {
        socket.emit("student:peer-id", peerRef.current.id);
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    if (socket.connected) {
      setConnected(true);
      socket.emit("student:join-session", id);
    }

    return () => {
      socket.off("connect");
      socket.off("session:joined");
      socket.off("session:error");
      socket.off("session:ended");
      socket.off("disconnect");
      disconnectSocket();
    };
  }, [id]);

  const handleCameraAnalysis = useCallback((data: { score: number; emotion: string }) => {
    setCurrentScore(data.score);
    setCurrentEmotion(data.emotion);

    tickRef.current += 1;
    setScoreHistory(prev => [
      ...prev.slice(-29),
      { t: tickRef.current, score: data.score },
    ]);

    const socket = getSocket();
    socket.emit("student:attention", {
      sessionId: id,
      score: data.score,
      emotion: data.emotion,
    });
  }, [id]);

  const handleCameraConsent = useCallback((granted: boolean) => {
    setCameraConsent(granted);
    if (granted) {
      setCameraActive(true);
    }
  }, []);

  const handleCameraReady = useCallback(() => {
    setCameraWorking(true);
  }, []);

  const handleCameraFailed = useCallback((reason: string) => {
    setCameraWorking(false);
    toast({ title: "Camera unavailable", description: "Using simulated monitoring instead. " + reason });
  }, []);

  const useFallback = joined && !sessionEnded && (cameraConsent === false || (cameraConsent === true && !cameraWorking));

  useEffect(() => {
    if (!useFallback) return;

    const socket = getSocket();
    let score = currentScore;

    const interval = window.setInterval(() => {
      const drift = (Math.random() - 0.45) * 10;
      score = Math.max(15, Math.min(100, score + drift));
      const roundedScore = Math.round(score);
      let emotion: string;
      if (score >= 80) emotion = Math.random() > 0.3 ? "focused" : "happy";
      else if (score >= 60) emotion = Math.random() > 0.5 ? "neutral" : "focused";
      else if (score >= 40) emotion = Math.random() > 0.5 ? "confused" : "bored";
      else emotion = Math.random() > 0.5 ? "distracted" : "bored";

      setCurrentScore(roundedScore);
      setCurrentEmotion(emotion);
      tickRef.current += 1;
      setScoreHistory(prev => [
        ...prev.slice(-29),
        { t: tickRef.current, score: roundedScore },
      ]);

      socket.emit("student:attention", {
        sessionId: id,
        score: roundedScore,
        emotion,
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [useFallback, id]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Loading session..." />
        <div className="p-6 space-y-4">
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (session?.status === "ended" || sessionEnded) {
    return (
      <div>
        <PageHeader title={sessionTitle || session?.title || "Session"} subtitle="Session has ended" />
        <div className="p-6">
          <Card>
            <CardContent className="p-8 md:p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                <WifiOff className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Session Ended</h3>
              <p className="text-sm text-muted-foreground mb-6">This session is no longer active.</p>

              {session?.summary && (
                <div className="mt-4 mb-8 text-left bg-blue-50/50 rounded-2xl p-6 md:p-8 border border-blue-100 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-blue-900 leading-tight">AI Lecture Summary</h4>
                      <p className="text-xs text-blue-600/70">Generated from the teacher's live transcript</p>
                    </div>
                  </div>
                  <div className="prose prose-sm prose-blue max-w-none text-blue-800/90 leading-relaxed">
                    {session.summary.split('\n').map((para: string, idx: number) => (
                      <p key={idx} className="mb-2 last:mb-0">{para}</p>
                    ))}
                  </div>
                </div>
              )}

              <Button onClick={() => setLocation("/student")} data-testid="button-back-dashboard">
                Back to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (cameraConsent === null && joined) {
    return (
      <div>
        <PageHeader
          title={sessionTitle || session?.title || "Live Session"}
          subtitle="Camera setup required"
        />
        <div className="p-6 flex items-center justify-center min-h-[60vh]">
          <CameraConsentDialog
            title="Enable Camera for Live Session"
            onConsent={handleCameraConsent}
          />
        </div>
      </div>
    );
  }

  const scoreColor = currentScore >= 75 ? "text-emerald-600" : currentScore >= 50 ? "text-amber-600" : "text-red-500";

  return (
    <div>
      <PageHeader
        title={sessionTitle || session?.title || "Live Session"}
        subtitle="Real-time attention monitoring active"
        actions={
          <div className="flex items-center gap-2">
            {cameraActive && cameraWorking && (
              <Badge className="bg-red-50 text-red-600 border-0" data-testid="badge-camera-active">
                <Camera className="w-3 h-3 mr-1" /> Camera Active
              </Badge>
            )}
            <Badge
              className={cn(
                "border-0",
                connected ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
              )}
              data-testid="badge-connection-status"
            >
              {connected ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
              {connected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {remoteStream && (
          <div className="w-full max-w-4xl mx-auto bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video mb-2 animate-in fade-in zoom-in duration-500">
            <video 
              ref={(v) => { if (v && !v.srcObject) v.srcObject = remoteStream; }}
              autoPlay playsInline
              className="w-full h-full object-contain"
            />
          </div>
        )}

        {joined && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-600" />
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-semibold text-emerald-700" data-testid="text-streaming-status">
                Streaming Attention Data
              </span>
            </div>
            <span className="text-xs text-emerald-500">
              {cameraActive && cameraWorking ? "Camera AI analyzing your face" : "Sending updates every 3 seconds"}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="hover-elevate">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Brain className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className={cn("text-2xl font-bold font-mono", scoreColor)} data-testid="text-current-score">
                  {currentScore}%
                </p>
                <p className="text-xs text-muted-foreground">Attention Score</p>
              </div>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
                <Eye className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-semibold capitalize" data-testid="text-current-emotion">
                  {currentEmotion}
                </p>
                <p className="text-xs text-muted-foreground">Current State</p>
              </div>
            </CardContent>
          </Card>

          <Card className="hover-elevate">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-amber-600" data-testid="text-data-points">
                  {scoreHistory.length}
                </p>
                <p className="text-xs text-muted-foreground">Data Points Sent</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              Your Attention Trend
              {joined && (
                <span className="flex items-center gap-1.5 text-xs font-normal text-emerald-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scoreHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={scoreHistory}>
                  <defs>
                    <linearGradient id="studentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563EB" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="t" hide />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #BFDBFE" }}
                    formatter={(v: number) => [`${Math.round(v)}%`, "Attention"]}
                  />
                  <Area type="monotone" dataKey="score" stroke="#2563EB" strokeWidth={2.5} fill="url(#studentGrad)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="py-12 text-center">
                <Zap className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Waiting for data...</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Brain className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-1">How Attention Monitoring Works</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {cameraActive && cameraWorking
                    ? "Your camera is active. The AI is analyzing your facial expressions to determine your engagement level and emotional state. No video is recorded — only attention scores are shared with your teacher."
                    : "Your attention score is streamed to your teacher in real-time using WebSocket technology. Enable your camera for more accurate facial sentiment analysis."
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <FaceMonitor
        active={cameraActive}
        onAnalysis={handleCameraAnalysis}
        onCameraReady={handleCameraReady}
        onCameraFailed={handleCameraFailed}
        intervalMs={3000}
        position="bottom-right"
        showScore={true}
      />
    </div>
  );
}
