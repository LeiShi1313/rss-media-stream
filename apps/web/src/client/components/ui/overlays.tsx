import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import type { SelectOption } from "./forms.js";

export function IconSelectMenu({
  label,
  icon,
  value,
  options,
  onValueChange,
  align = "end",
  side = "bottom",
  className
}: {
  label: string;
  icon: ReactNode;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger
        aria-label={label}
        className={clsx("menu-trigger", className)}
        title={label}
        type="button"
      >
        {icon}
        <span className="sr-only">{label}</span>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="menu-content"
          align={align}
          side={side}
          sideOffset={6}
        >
          <DropdownMenuPrimitive.RadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <DropdownMenuPrimitive.RadioItem
                className="menu-item"
                key={option.value}
                value={option.value}
              >
                <span>{option.label}</span>
                <DropdownMenuPrimitive.ItemIndicator className="menu-item-indicator">
                  <Check size={14} />
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
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
