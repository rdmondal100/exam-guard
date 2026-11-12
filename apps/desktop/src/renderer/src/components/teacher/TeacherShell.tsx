import { useState } from 'react';
import {
  FileTextIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import type { AppInfo, ServerStatus } from '@examguard/shared';
import { Separator } from '@/components/ui/separator';
import { Sidebar, SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebarMenu';
import { ClassListsPage } from '../../pages/teacher/ClassListsPage';
import { ExamsPage } from '../../pages/teacher/ExamsPage';
import { HomePage } from '../../pages/teacher/HomePage';
import { SettingsPage } from '../../pages/teacher/SettingsPage';
import { AppMark } from '../common/AppMark';
import { ServerStatusChip } from '../common/ServerStatusChip';

const NAV = ['Home', 'Class lists', 'Exams', 'Settings'] as const;
type Page = (typeof NAV)[number];

const ICONS: Record<Page, LucideIcon> = {
  Home: LayoutDashboardIcon,
  'Class lists': UsersIcon,
  Exams: FileTextIcon,
  Settings: SettingsIcon,
};

interface Props {
  info: AppInfo;
  serverStatus: ServerStatus | null;
  onLogout: () => void;
}

/** Shell behind the login gate (M51): the collapsible sidebar plus the current page. */
export function TeacherShell({ info, serverStatus, onLogout }: Props) {
  const [page, setPage] = useState<Page>('Home');
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="h-14 justify-center border-b">
          <AppMark withName className="group-data-[collapsible=icon]:[&>span]:hidden" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup role="navigation" aria-label="Teacher">
            <SidebarGroupLabel>Teacher</SidebarGroupLabel>
            <SidebarMenu>
              {NAV.map((label) => {
                const Icon = ICONS[label];
                return (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      isActive={label === page}
                      tooltip={label}
                      onClick={() => setPage(label)}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">
          {serverStatus && (
            <ServerStatusChip
              status={serverStatus}
              className="mx-1 group-data-[collapsible=icon]:hidden"
            />
          )}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Log out" onClick={onLogout}>
                <LogOutIcon />
                <span>Log out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-[5] flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4!" />
          <span className="text-sm font-medium">{page}</span>
        </header>
        <div className="flex-1 p-6 lg:p-8">
          {page === 'Home' ? (
            <HomePage
              info={info}
              serverStatus={serverStatus}
              onOpenExams={() => setPage('Exams')}
            />
          ) : page === 'Exams' ? (
            <ExamsPage />
          ) : page === 'Settings' ? (
            <SettingsPage />
          ) : (
            <ClassListsPage />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
