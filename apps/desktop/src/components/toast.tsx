import { useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { toast as sonner } from "sonner";
import { Button, ExpanderButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { toastDuration, toastRole, type ToastVariant } from "@/lib/toast";

export type { ToastVariant } from "@/lib/toast";

export type ToastAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type ToastOptions = {
  description?: string;
  action?: ToastAction;
  secondaryAction?: ToastAction;
  details?: string | null;
  detailsLabel?: string;
  durationMs?: number;
  sticky?: boolean;
  id?: string | number;
};

type ToastId = string | number;

let seq = 0;
const nextToastId = (): ToastId => `sonda-toast-${++seq}`;

function ToastBody({
  id,
  variant,
  options,
  detailsOpen,
  onToggleDetails,
}: {
  id: ToastId;
  variant: ToastVariant;
  options: ToastOptions;
  detailsOpen: boolean;
  onToggleDetails: (open: boolean) => void;
}) {
  const { description, action, secondaryAction, details, detailsLabel } = options;
  const hasActions = action != null || secondaryAction != null;
  const hasDetails = details != null && details !== "" && detailsLabel != null;

  return (
    <div
      role={toastRole(variant)}
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          sonner.dismiss(id);
        }
      }}
    >
      {description && <span className="block">{description}</span>}

      {(hasActions || hasDetails) && (
        <div className="flex flex-wrap items-center gap-2">
          {action && (
            <Button variant="primary" size="sm" disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="ghost"
              size="sm"
              disabled={secondaryAction.disabled}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
          {hasDetails && (
            <ExpanderButton
              open={detailsOpen}
              onClick={() => onToggleDetails(!detailsOpen)}
              className="ml-auto text-[11.5px]"
            >
              {detailsLabel}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none",
                  detailsOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </ExpanderButton>
          )}
        </div>
      )}

      {hasDetails && detailsOpen && (
        <p className="num break-words border-t border-divider pt-2 text-[11px] leading-snug text-neutral-500">
          {details}
        </p>
      )}
    </div>
  );
}

function raise(variant: ToastVariant, title: string, options: ToastOptions = {}): ToastId {
  const id = options.id ?? nextToastId();

  const hasBody =
    options.description != null ||
    options.action != null ||
    options.secondaryAction != null ||
    (options.details != null && options.details !== "");

  const emit = (detailsOpen: boolean) =>
    sonner[variant](title, {
      id,
      duration: toastDuration(variant, { ...options, detailsOpen }),
      closeButton: true,
      description:
        hasBody || toastRole(variant) === "alert" ? (
          <ToastBody
            id={id}
            variant={variant}
            options={options}
            detailsOpen={detailsOpen}
            onToggleDetails={(open) => emit(open)}
          />
        ) : undefined,
    });

  return emit(false);
}

function dismiss(id?: ToastId) {
  sonner.dismiss(id);
}

export const toast = {
  success: (title: string, options?: ToastOptions) => raise("success", title, options),
  info: (title: string, options?: ToastOptions) => raise("info", title, options),
  warning: (title: string, options?: ToastOptions) => raise("warning", title, options),
  error: (title: string, options?: ToastOptions) => raise("error", title, options),
  dismiss,
};

export function useToast() {
  const show = useCallback(
    (variant: ToastVariant, title: string, options?: ToastOptions) => raise(variant, title, options),
    [],
  );
  const hide = useCallback((id?: ToastId) => dismiss(id), []);
  return useMemo(() => ({ show, dismiss: hide }), [show, hide]);
}
