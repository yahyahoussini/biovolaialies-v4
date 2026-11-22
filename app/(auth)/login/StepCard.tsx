import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/Card";

/** The frame of each sign-in step, matching the sign-in card. */
export function StepCard({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <Card className="w-full max-w-md shadow-sm">
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-bio-green/10 text-bio-green">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-section-title">{title}</h1>
          <p className="text-caption text-secondary">{intro}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
