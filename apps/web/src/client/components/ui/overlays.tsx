import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

export type MenuOption = {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

export function MenuButton({
  label,
  icon,
  items,
  align = "end",
  className
}: {
  label: ReactNode;
  icon?: ReactNode;
  items: MenuOption[];
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger className={clsx("menu-trigger", className)} type="button">
        {icon}
        {label}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content className="menu-content" align={align} sideOffset={6}>
          {items.map((item) => (
            <DropdownMenuPrimitive.Item
              className="menu-item"
              disabled={item.disabled}
              key={item.label}
              onSelect={item.onSelect}
            >
              {item.icon}
              {item.label}
            </DropdownMenuPrimitive.Item>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

export type TabOption = {
  value: string;
  label: string;
  count?: number;
};

export function SegmentedTabs({
  value,
  onValueChange,
  tabs
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: TabOption[];
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List className="segmented-tabs">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger className="segmented-tab" key={tab.value} value={tab.value}>
            {tab.label}
            {tab.count !== undefined && <span>{tab.count}</span>}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={350}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  content,
  children
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="tooltip-content" sideOffset={7}>
          {content}
          <TooltipPrimitive.Arrow className="tooltip-arrow" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function StatTile({
  label,
  value,
  detail,
  icon,
  tone = "neutral"
}: {
  label: string;
  value: number | string;
  detail?: string;
  icon: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger" | "accent";
}) {
  return (
    <article className={`stat-tile ${tone}`}>
      <span className="stat-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </article>
  );
}

