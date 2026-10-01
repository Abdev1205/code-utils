"use client";

import { Check, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { CollectionIcon } from "@/components/understand/collection-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { UTILS, type SubnavItem } from "@/lib/utils-registry";

export function AppSidebar({
  subnav = {},
}: {
  /** Second-level entries per tool slug, built by the layout. */
  subnav?: Partial<Record<string, SubnavItem[]>>;
}) {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  // Collapsed to icons, the inline sub-list has nowhere to go, so a tool with
  // sub-entries opens them as a menu from its icon instead of a bare tooltip.
  const iconRail = state === "collapsed" && !isMobile;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Wrench className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">utils</span>
                <span className="truncate text-xs text-muted-foreground">
                  local toolbox
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
          <SidebarMenu>
            {UTILS.map((util) => {
              const active =
                pathname === `/${util.slug}` ||
                pathname.startsWith(`/${util.slug}/`);
              const items = subnav[util.slug];
              if (iconRail && items && items.length > 0) {
                return (
                  <SidebarMenuItem key={util.slug}>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<SidebarMenuButton isActive={active} />}
                      >
                        <util.icon />
                        <span>{util.name}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="right"
                        align="start"
                        sideOffset={6}
                        className="min-w-56"
                      >
                        {/* Base UI requires the label to sit inside a group. */}
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>{util.name}</DropdownMenuLabel>
                          <React.Suspense fallback={null}>
                            <SubnavMenuItems slug={util.slug} items={items} />
                          </React.Suspense>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                );
              }
              return (
                <SidebarMenuItem key={util.slug}>
                  <SidebarMenuButton
                    isActive={active}
                    tooltip={util.name}
                    render={<Link href={`/${util.slug}`} />}
                  >
                    <util.icon />
                    <span>{util.name}</span>
                  </SidebarMenuButton>
                  {/* useSearchParams needs a Suspense boundary above it, or
                      `next build` fails on the static routes this layout wraps. */}
                  {active && items && items.length > 0 && (
                    <React.Suspense fallback={null}>
                      <Subnav slug={util.slug} items={items} />
                    </React.Suspense>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 px-1 group-data-[collapsible=icon]:justify-center">
          <span className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            Runs on your Mac
          </span>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * The sub-entries filter the tool's index page, so one is active only when
 * you're on that page: `/understand` → All, `/understand?collection=x` → x.
 * On a document page its collection stays lit; on Progress nothing is.
 */
function useCurrentSubnav(slug: string, items: SubnavItem[]): string | null {
  const pathname = usePathname();
  const params = useSearchParams();
  if (pathname === `/${slug}`) return params.get("collection") ?? "all";
  if (pathname === `/${slug}/doc`) {
    const id = params.get("id") ?? "";
    return items.find((i) => i.prefix && id.startsWith(i.prefix))?.id ?? null;
  }
  return null;
}

/** Expanded sidebar: the entries sit inline under the tool. */
function Subnav({ slug, items }: { slug: string; items: SubnavItem[] }) {
  const current = useCurrentSubnav(slug, items);

  return (
    <SidebarMenuSub>
      {items.map((item) => (
        <SidebarMenuSubItem key={item.id}>
          <SidebarMenuSubButton
            isActive={current === item.id}
            render={<Link href={item.href} />}
          >
            {item.icon && <CollectionIcon name={item.icon} />}
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
                {item.count}
              </span>
            )}
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  );
}

/** Icon rail: the same entries, as a menu anchored to the tool's icon. */
function SubnavMenuItems({
  slug,
  items,
}: {
  slug: string;
  items: SubnavItem[];
}) {
  const current = useCurrentSubnav(slug, items);
  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem key={item.id} render={<Link href={item.href} />}>
          {item.icon ? (
            <CollectionIcon name={item.icon} className="size-4" />
          ) : (
            <span className="size-4" />
          )}
          <span className="flex-1 truncate">{item.label}</span>
          {item.count !== undefined && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {item.count}
            </span>
          )}
          {current === item.id && <Check className="size-3.5" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}
