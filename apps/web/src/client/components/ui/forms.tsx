import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as LabelPrimitive from "@radix-ui/react-label";
import { Primitive } from "@radix-ui/react-primitive";
import * as SelectPrimitive from "@radix-ui/react-select";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

const emptySelectValue = "__rss_media_empty__";

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

