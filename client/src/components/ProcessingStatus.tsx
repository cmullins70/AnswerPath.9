import { useQuery } from "@tanstack/react-query";
import { ProcessingStatusType } from "@/lib/types";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Circle, Clock } from "lucide-react";

export function ProcessingStatus() {
  const { data: status } = useQuery<ProcessingStatusType>({
    queryKey: ["/api/processing/status"],
  });

  const steps = [
    { id: "extraction", label: "Content Extraction" },
    { id: "questions", label: "Question Identification" },
    { id: "analysis", label: "Context Analysis" },
    { id: "generation", label: "Answer Generation" },
  ];

  return (
    <div className="space-y-6">
      <Progress
        value={
          status
            ? (steps.findIndex((s) => s.id === status.currentStep) + 1) * 25
            : 0
        }
      />

      <div className="grid gap-4">
        {steps.map((step) => {
          const isActive = status?.currentStep === step.id;
          const isComplete = status?.completedSteps.includes(step.id);

          return (
            <Card key={step.id}>
              <CardContent className="flex items-center p-4">
                {isComplete ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : isActive ? (
                  <Clock className="h-5 w-5 text-blue-500 animate-pulse" />
                ) : (
                  <Circle className="h-5 w-5 text-gray-300" />
                )}
                <span className="ml-3 font-medium">{step.label}</span>
                {isActive && (
                  <span className="ml-auto text-sm text-muted-foreground">
                    In Progress...
                  </span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
