import { Link, useLocation } from "wouter";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard, BookOpen, Users, Video, BarChart3,
  Bell, LogOut, Settings, GraduationCap, User, Shield,
  Trophy, ClipboardCheck, FileText, Sparkles, ShieldAlert, MessageCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { logout } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

const teacherNav = [
  { title: "Dashboard", url: "/teacher", icon: LayoutDashboard },
  { title: "My Classes", url: "/teacher/classes", icon: Users },
  { title: "Quizzes", url: "/teacher/quizzes", icon: ClipboardCheck },
  { title: "Books & Materials", url: "/teacher/books", icon: BookOpen },
  { title: "Analytics", url: "/teacher/analytics", icon: BarChart3 },
  { title: "Reports", url: "/teacher/reports", icon: FileText },
  { title: "AI Advisor", url: "/teacher/ai-advisor", icon: Sparkles },
  { title: "Submissions", url: "/teacher/submissions", icon: FileText },
  { title: "Plagiarism Check", url: "/teacher/plagiarism", icon: ShieldAlert },
];

const studentNav = [
  { title: "Dashboard", url: "/student", icon: LayoutDashboard },
  { title: "My Classes", url: "/student", icon: Users },
  { title: "Messages", url: "/student/messages", icon: MessageCircle },
  { title: "My Profile", url: "/student/profile", icon: User },
];

const adminNav = [
  { title: "Dashboard", url: "/admin", icon: Shield },
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Classes", url: "/admin/classes", icon: BookOpen },
];

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function getRoleColor(role: string) {
  if (role === "teacher") return "bg-blue-100 text-blue-700";
  if (role === "admin") return "bg-purple-100 text-purple-700";
  return "bg-emerald-100 text-emerald-700";
}

function getRoleLabel(role: string) {
  if (role === "teacher") return "Teacher";
  if (role === "admin") return "Admin";
  return "Student";
}

export function AppSidebar() {
  const { user } = useAuth();
  const [location] = useLocation();
  const { data: notifications } = useQuery<any[]>({ queryKey: ["/api/notifications"] });
  const unread = notifications?.filter((n: any) => !n.read).length || 0;
  const { data: unreadMessages } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    enabled: user?.role === "student",
    refetchInterval: 10000,
  });

  const navItems = user?.role === "teacher" ? teacherNav : user?.role === "admin" ? adminNav : studentNav;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <img
            src="/favicon.png"
            alt="EduSense Logo"
            className="w-8 h-8 rounded-md flex-shrink-0 object-contain"
          />
          <div className="group-data-[collapsible=icon]:hidden min-w-0">
            <p className="text-sm font-bold text-sidebar-foreground tracking-tight">EduSense AI</p>
            <p className="text-[11px] text-muted-foreground">Smart Learning Platform</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 mb-1">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/teacher" && item.url !== "/student" && item.url !== "/admin" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                        {item.title === "Messages" && (unreadMessages?.count || 0) > 0 && (
                          <Badge className="ml-auto h-5 min-w-5 rounded-full bg-red-500 text-white text-[10px] px-1.5 flex items-center justify-center">
                            {unreadMessages!.count}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user?.role === "student" && (
          <SidebarGroup className="mt-2">
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 mb-1">
              Progress
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="group-data-[collapsible=icon]:hidden px-2 py-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Level {user.level}</span>
                  <span className="text-xs font-semibold text-primary">{user.xp} XP</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.min(100, ((user.xp % 200) / 200) * 100)}%` }}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Trophy className="w-3 h-3 text-amber-500" />
                  <span className="text-xs text-muted-foreground">{user.streakDays} day streak</span>
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="px-2 py-3 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href={user?.role === "student" ? "/student/profile" : "#"} className="flex items-center gap-2.5">
                <Avatar className="w-6 h-6 flex-shrink-0">
                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-semibold">
                    {user ? getInitials(user.name) : "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="group-data-[collapsible=icon]:hidden min-w-0 flex-1">
                  <p className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout} data-testid="button-logout">
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
