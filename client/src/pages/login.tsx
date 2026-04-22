import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Brain, Eye, EyeOff, GraduationCap, Users, Shield, Zap, BarChart3, BookOpen } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

const demoAccounts = [
  { role: "Teacher", username: "teacher1", password: "password123", icon: GraduationCap, color: "bg-blue-50 border-blue-200 text-blue-700", badgeColor: "bg-blue-100 text-blue-700" },
  { role: "Student", username: "student1", password: "password123", icon: Users, color: "bg-emerald-50 border-emerald-200 text-emerald-700", badgeColor: "bg-emerald-100 text-emerald-700" },
  { role: "Admin", username: "admin", password: "password123", icon: Shield, color: "bg-purple-50 border-purple-200 text-purple-700", badgeColor: "bg-purple-100 text-purple-700" },
];

const features = [
  { icon: BarChart3, title: "Real-Time Attention", desc: "AI-powered attention tracking during live sessions" },
  { icon: BookOpen, title: "Smart Book Reader", desc: "Adaptive content with boredom detection" },
  { icon: Zap, title: "Gamification", desc: "XP, badges, and streaks to motivate students" },
  { icon: Brain, title: "Learning Style AI", desc: "Personalized content based on learning patterns" },
];

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: (data: LoginForm) => apiRequest("POST", "/api/auth/login", data),
    onSuccess: async (user: any) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      const route = user.role === "teacher" ? "/teacher" : user.role === "admin" ? "/admin" : "/student";
      setLocation(route);
    },
    onError: () => {
      toast({ title: "Login failed", description: "Invalid username or password", variant: "destructive" });
    },
  });

  function fillDemo(username: string, password: string) {
    form.setValue("username", username);
    form.setValue("password", password);
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFC]">
      {/* Left Panel — Branding */}
      <div className="hidden lg:flex lg:w-[52%] bg-[#1E3A5F] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 rounded-full bg-blue-400 blur-3xl" />
          <div className="absolute bottom-32 right-20 w-80 h-80 rounded-full bg-sky-300 blur-3xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <img
              src="/favicon.png"
              alt="EduSense Logo"
              className="w-10 h-10 rounded-xl object-contain bg-white/10 p-1"
            />
            <div>
              <h1 className="text-white font-bold text-xl tracking-tight">EduSense AI</h1>
              <p className="text-blue-200 text-xs">Smart Classroom Platform</p>
            </div>
          </div>
          <div className="mb-12">
            <h2 className="text-white text-4xl font-bold leading-tight mb-4">
              The future of<br />intelligent education
            </h2>
            <p className="text-blue-200 text-base leading-relaxed max-w-sm">
              AI-powered attention monitoring, adaptive learning, and deep analytics — all in one platform.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {features.map(f => (
              <div key={f.title} className="bg-white/10 rounded-xl p-4 backdrop-blur-sm border border-white/10">
                <f.icon className="w-5 h-5 text-blue-300 mb-2.5" />
                <p className="text-white text-sm font-semibold mb-1">{f.title}</p>
                <p className="text-blue-200 text-xs leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-8 text-blue-300 text-sm">
          <span>v1.0 — 2025</span>
          <span>·</span>
          <span>FERPA Compliant</span>
          <span>·</span>
          <span>Privacy-First AI</span>
        </div>
      </div>

      {/* Right Panel — Login */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-[400px] space-y-6">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <img
              src="/favicon.png"
              alt="EduSense Logo"
              className="w-9 h-9 rounded-xl object-contain"
            />
            <div>
              <p className="font-bold text-foreground">EduSense AI</p>
              <p className="text-xs text-muted-foreground">Smart Classroom Platform</p>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-[#1E293B]">Welcome back</h2>
            <p className="text-[#64748B] text-sm mt-1">Sign in to your account to continue</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => loginMutation.mutate(d))} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-[#1E293B]">Username</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Enter your username"
                        data-testid="input-username"
                        className="h-10 bg-white border-[#BFDBFE] focus-visible:ring-[#2563EB]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-[#1E293B]">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showPassword ? "text" : "password"}
                          placeholder="Enter your password"
                          data-testid="input-password"
                          className="h-10 bg-white border-[#BFDBFE] focus-visible:ring-[#2563EB] pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          data-testid="button-toggle-password"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full h-10 bg-[#2563EB] text-white font-semibold"
                disabled={loginMutation.isPending}
                data-testid="button-login"
              >
                {loginMutation.isPending ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </Form>

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#F8FAFC] px-3 text-xs text-muted-foreground">
              Demo Accounts
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {demoAccounts.map(acc => (
              <button
                key={acc.role}
                type="button"
                onClick={() => fillDemo(acc.username, acc.password)}
                data-testid={`button-demo-${acc.role.toLowerCase()}`}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border ${acc.color} cursor-pointer transition-all hover-elevate`}
              >
                <acc.icon className="w-5 h-5" />
                <span className="text-xs font-semibold">{acc.role}</span>
                <span className="text-[10px] font-mono opacity-70">{acc.username}</span>
              </button>
            ))}
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            AI runs entirely client-side — no video is transmitted or stored.
          </p>
        </div>
      </div>
    </div>
  );
}
