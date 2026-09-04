"use client"

import * as React from "react"
import { CirclePlus, FilePenLine, Mic, RefreshCw, Settings2, Square } from "lucide-react"

import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip"
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
  onRefreshClick: () => void
  refreshing: boolean
  syncActive: boolean
  syncBusy: boolean
  syncDisabled: boolean
  syncTooltip: string
  onSyncClick: () => void
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
  onRefreshClick,
  refreshing,
  syncActive,
  syncBusy,
  syncDisabled,
  syncTooltip,
  onSyncClick,
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
        <SidebarHeader className="app-sidebar-header" data-tauri-drag-region>
          <SidebarMenu data-tauri-drag-region>
            <SidebarMenuItem className="flex items-center gap-2" data-tauri-drag-region>
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
                <SidebarMenuItem className="flex items-center gap-2">
                  <SidebarMenuButton asChild className="min-w-0 flex-1" isActive={settingsActive}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={onSettingsClick}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          onSettingsClick()
                        }
                      }}
                    >
                      <Settings2 />
                      <span className="min-w-0 flex-1 truncate">Settings</span>
                      <TooltipProvider delayDuration={1000}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="grid size-5 shrink-0 place-items-center rounded opacity-0 transition-opacity hover:bg-sidebar-accent-foreground/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:cursor-not-allowed disabled:opacity-50 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100"
                              onClick={(event) => {
                                event.stopPropagation()
                                onRefreshClick()
                              }}
                              disabled={refreshing}
                              aria-label="Refresh"
                              title="Refresh"
                            >
                              <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
                              <span className="sr-only">Refresh</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6}>
                            Refresh
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </SidebarMenuButton>
                  <TooltipProvider delayDuration={1000}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={onSyncClick}
                          disabled={syncDisabled}
                          aria-label={syncActive ? "Stop sync server" : "Start sync server"}
                          aria-pressed={syncActive}
                        >
                          <span
                            className={cn(
                              "size-2.5 rounded-full bg-muted-foreground/45 transition-colors",
                              syncActive && "bg-emerald-500",
                              syncBusy && "animate-pulse"
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6}>
                        {syncTooltip}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}
