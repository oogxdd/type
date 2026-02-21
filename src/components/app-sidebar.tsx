"use client"

import * as React from "react"
import { CirclePlus, Home, Mic, Settings2, Square, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  feedActive: boolean
  settingsActive: boolean
  trashActive: boolean
  recordingActive: boolean
  recordingDisabled: boolean
  onFeedClick: () => void
  onNewNoteClick: () => void
  onRecordingClick: () => void
  onSettingsClick: () => void
  onTrashClick: () => void
  children: React.ReactNode
}

export function AppSidebar({
  feedActive,
  settingsActive,
  trashActive,
  recordingActive,
  recordingDisabled,
  onFeedClick,
  onNewNoteClick,
  onRecordingClick,
  onSettingsClick,
  onTrashClick,
  className,
  children,
  ...props
}: AppSidebarProps) {
  return (
    <SidebarProvider className="h-full min-h-0 w-full">
      <Sidebar
        collapsible="none"
        className={cn("app-sidebar-shell tree-pane nav-pane h-full w-full border-r-0", className)}
        {...props}
      >
        <SidebarHeader className="app-sidebar-header">
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-2">
              <SidebarMenuButton
                className="app-sidebar-primary-button bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear"
                onClick={onNewNoteClick}
              >
                <CirclePlus />
                <span>New note</span>
              </SidebarMenuButton>
              <Button
                size="icon-sm"
                variant="outline"
                className={cn(
                  "size-8 group-data-[collapsible=icon]:opacity-0",
                  recordingActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : undefined
                )}
                onClick={onRecordingClick}
                disabled={recordingDisabled}
                aria-label={recordingActive ? "Stop recording" : "Record audio"}
                title={recordingActive ? "Stop recording" : "Record audio"}
              >
                {recordingActive ? <Square /> : <Mic />}
                <span className="sr-only">
                  {recordingActive ? "Stop recording" : "Record audio"}
                </span>
              </Button>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={feedActive}
                onClick={onFeedClick}
                className="app-sidebar-menu-button"
              >
                <Home />
                <span>Feed</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent className="app-sidebar-content">
          <SidebarGroup className="min-h-0 flex-1 px-0 pb-0">
            <SidebarGroupLabel>Folders</SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0 flex-1">{children}</SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={trashActive}
                    onClick={onTrashClick}
                    className="app-sidebar-menu-button"
                  >
                    <Trash2 />
                    <span>Trash</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={settingsActive}
                    onClick={onSettingsClick}
                    className="app-sidebar-menu-button"
                  >
                    <Settings2 />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}
