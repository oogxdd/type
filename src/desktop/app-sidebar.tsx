"use client"

import * as React from "react"
import { CirclePlus, FilePenLine, Home, MessageCircle, Mic, Search, Settings2, Square, Trash2 } from "lucide-react"

import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
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
} from "@/shared/ui/sidebar"

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  feedActive: boolean
  settingsActive: boolean
  trashActive: boolean
  recordingActive: boolean
  recordingDisabled: boolean
  handwritingImportDisabled: boolean
  onFeedClick: () => void
  onNewNoteClick: () => void
  onRecordingClick: () => void
  onHandwritingImportClick: () => void
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
  handwritingImportDisabled,
  onFeedClick,
  onNewNoteClick,
  onRecordingClick,
  onHandwritingImportClick,
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
        className={cn("app-sidebar-shell pane tree-pane nav-pane h-full w-full border-r-0", className)}
        {...props}
      >
        <SidebarHeader className="app-sidebar-header">
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-2">
              <SidebarMenuButton onClick={onNewNoteClick}>
                <CirclePlus />
                <span>New note</span>
              </SidebarMenuButton>
              <Button
                size="icon-sm"
                variant="outline"
                className="app-sidebar-recording-button size-8 group-data-[collapsible=icon]:opacity-0"
                data-active={recordingActive ? "true" : "false"}
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
              <Button
                size="icon-sm"
                variant="outline"
                className="size-8 group-data-[collapsible=icon]:opacity-0"
                onClick={onHandwritingImportClick}
                disabled={handwritingImportDisabled}
                aria-label="Import handwriting"
                title="Import handwriting"
              >
                <FilePenLine />
                <span className="sr-only">Import handwriting</span>
              </Button>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => {}}>
                <Search />
                <span>Search</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => {}}>
                <MessageCircle />
                <span>Chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={feedActive} onClick={onFeedClick}>
                <Home />
                <span>Feed</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent className="app-sidebar-content">
          <SidebarGroup className="min-h-0 flex-1 px-0 pb-0">
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0 flex-1">{children}</SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={trashActive} onClick={onTrashClick}>
                    <Trash2 />
                    <span>Trash</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={settingsActive} onClick={onSettingsClick}>
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
