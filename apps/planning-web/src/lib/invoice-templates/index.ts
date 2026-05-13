import { ClassicTemplate } from "./classic";
import { ModernTemplate } from "./modern";
import { CustomTemplate } from "./custom";
import type { InvoiceTemplateId, TemplateProps } from "./types";

type TemplateRenderer = (props: TemplateProps) => React.ReactElement;

export const TEMPLATES: Record<InvoiceTemplateId, { id: InvoiceTemplateId; name: string; render: TemplateRenderer }> = {
  classic: { id: "classic", name: "Classic", render: ClassicTemplate },
  modern:  { id: "modern",  name: "Modern",  render: ModernTemplate  },
  custom:  { id: "custom",  name: "Custom",  render: CustomTemplate  },
};

export function getTemplate(id: string | null | undefined): typeof TEMPLATES[InvoiceTemplateId] {
  if (id && id in TEMPLATES) return TEMPLATES[id as InvoiceTemplateId];
  return TEMPLATES.classic;
}

export type { InvoiceTemplateId, TemplateProps } from "./types";
export { TEMPLATE_LABELS, TEMPLATE_DESCRIPTIONS, TEMPLATE_IDS } from "./types";
