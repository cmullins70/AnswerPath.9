import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ProcessingStatusType } from "@/lib/types";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Circle, Clock, HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ProcessingStatus() {
  const { data: status } = useQuery<ProcessingStatusType>({
    queryKey: ["/api/processing/status"],
  });

  const steps = [
    {
      id: "extraction",
      label: "Content Extraction",
      description: "Converting document contents into processable text"
    },
    {
      id: "questions",
      label: "Question Identification",
      description: "Detecting explicit and implicit questions in the document"
    },
    {
      id: "analysis",
      label: "Context Analysis",
      description: "Analyzing document context and preparing knowledge base"
    },
    {
      id: "generation",
      label: "Answer Generation",
      description: "Generating accurate responses with source references"
    },
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
              <CardContent className="p-4">
                <div className="flex items-center">
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                  ) : isActive ? (
                    <Clock className="h-5 w-5 text-blue-500 animate-pulse flex-shrink-0" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-300 flex-shrink-0" />
                  )}
                  <div className="ml-3 flex-grow">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{step.label}</h4>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{step.description}</p>
                            {step.id === "extraction" && (
                              <p>Handles multiple file formats and structures</p>
                            )}
                            {step.id === "questions" && (
                              <p>Uses AI to identify both direct and indirect questions</p>
                            )}
                            {step.id === "analysis" && (
                              <p>Links questions with relevant context and requirements</p>
                            )}
                            {step.id === "generation" && (
                              <p>Generates accurate responses with confidence scores</p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {step.description}
                    </p>
                  </div>
                  {isActive && (
                    <span className="ml-auto text-sm text-blue-500 font-medium">
                      In Progress...
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
