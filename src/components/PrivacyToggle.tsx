import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePrivacy } from "@/hooks/usePrivacy";

interface PrivacyToggleProps {
  className?: string;
}

export function PrivacyToggle({ className }: PrivacyToggleProps) {
  const { hidden, toggle } = usePrivacy();
  const label = hidden ? "Mostrar valores" : "Ocultar valores";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          onClick={toggle}
          aria-label={label}
          aria-pressed={hidden}
        >
          {hidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
