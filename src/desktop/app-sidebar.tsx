"use client"

import * as React from "react"
import { CirclePlus, FilePenLine, Mic, Settings2, Square } from "lucide-react"

import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/shared/ui/sidebar"

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  settingsActive: boolean
  recordingActive: boolean
  recordingDisabled: boolean
  handwritingImportDisabled: boolean
  onNewNoteClick: () => void
  onRecordingClick: () => void
  onHandwritingImportClick: () => void
  onSettingsClick: () => void
  children: React.ReactNode
}

export function AppSidebar({
  settingsActive,
  recordingActive,
  recordingDisabled,
  handwritingImportDisabled,
  onNewNoteClick,
  onRecordingClick,
  onHandwritingImportClick,
  onSettingsClick,
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
        </SidebarHeader>

        <SidebarContent className="app-sidebar-content">
          <SidebarGroup className="min-h-0 flex-1 px-0 pb-0">
            <SidebarGroupContent className="min-h-0 flex-1">{children}</SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
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
