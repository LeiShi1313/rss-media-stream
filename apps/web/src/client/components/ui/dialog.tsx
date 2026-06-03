import * as DialogPrimitive from "@radix-ui/react-dialog";
import clsx from "clsx";
import { X } from "lucide-react";
import type { ReactNode } from "react";

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
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className={clsx("dialog-content", className)}>
          <header className="dialog-header">
            <div>
              <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={description ? "dialog-description" : "sr-only"}>
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

