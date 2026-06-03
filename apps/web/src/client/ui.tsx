import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Primitive } from "@radix-ui/react-primitive";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { Check, ChevronDown, X } from "lucide-react";
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from "react";

const emptySelectValue = "__rss_media_empty__";

export function AppDialog({
  title,
  description,
  children,
  className,
  onClose
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  onClose: () => void;
}) {
  const descriptionText = description?.trim() || "No additional details";
  const descriptionId = useId();
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className={clsx("dialog-content", className)} aria-describedby={descriptionId}>
          <header className="dialog-header">
            <div>
              <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description
                id={descriptionId}
                className={description ? "dialog-description" : "sr-only"}
              >
                {descriptionText}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="icon-button" aria-label="Close" type="button">
              <X size={18} />
            </DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export type SelectOption = {
  value: string;
  label: string;
};

export function SelectField({
  value,
  onValueChange,
  options,
  placeholder = "Select",
  disabled = false,
  className
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root
      value={value || emptySelectValue}
      onValueChange={(nextValue) => onValueChange(nextValue === emptySelectValue ? "" : nextValue)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger className={clsx("select-trigger", className)} aria-label={placeholder}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="select-content" position="popper" sideOffset={6}>
          <SelectPrimitive.Viewport className="select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="select-item"
                key={`${option.value}:${option.label}`}
                value={option.value || emptySelectValue}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-item-indicator">
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function CheckboxField({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={clsx("checkbox-control", className)}>
      <CheckboxPrimitive.Root
        checked={checked}
        className="checkbox-root"
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      >
        <CheckboxPrimitive.Indicator className="checkbox-indicator">
          <Check size={13} strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && <span>{label}</span>}
    </label>
  );
}

export function UiButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Primitive.button className={className} {...props}>
      {children}
    </Primitive.button>
  );
}

export function FormInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <Primitive.input className={clsx(className)} {...props} />;
}

export function FieldLabel({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return <LabelPrimitive.Root className={clsx(className)} {...props} />;
}

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
