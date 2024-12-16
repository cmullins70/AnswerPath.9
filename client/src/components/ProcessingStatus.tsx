import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ProcessingStatusType, DocumentType } from "@/lib/types";
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
  const { data: documents } = useQuery<DocumentType[]>({
    queryKey: ["/api/documents"],
  });

  const processingDocuments = documents?.filter(doc => doc.status === 'processing') ?? [];
  
  const { data: status } = useQuery<ProcessingStatusType>({
    queryKey: ["/api/processing/status", processingDocuments[0]?.id],
    enabled: processingDocuments.length > 0,
    refetchInterval: (data) => {
      if (!data || (data.currentStep !== "complete" && data.currentStep !== "error")) {
        return 1000; // Poll every second while processing
      }
      return false; // Stop polling when complete or error
    },
  });

  if (!processingDocuments.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No documents are currently being processed
      </div>
    );
  }

  const steps = [
    {
      id: "preparation",
      label: "Preparation",
      description: "Preparing document for processing"
    },
    {
      id: "extraction",
      label: "Content Extraction",
      description: "Converting document contents into processable text"
    },
    {
      id: "questions",
      label: "Question Identification",
      description: "Detecting explicit and implicit questions"
    },
    {
      id: "analysis",
      label: "Context Analysis",
      description: "Analyzing context and preparing responses"
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Progress
          value={status?.progress ?? 0}
          className={status?.currentStep === "error" ? "bg-red-200" : ""}
        />
        <span className="text-sm font-medium">
          {status?.progress ?? 0}%
        </span>
      </div>

      <div className="grid gap-4">
        {steps.map((step) => {
          const isActive = status?.currentStep === step.id;
          const isComplete = status?.completedSteps?.includes(step.id);
          const isError = status?.currentStep === "error";

          return (
            <Card key={step.id} className={isError ? "border-red-200" : ""}>
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
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isActive ? "In progress..." : step.description}
                    </p>
                  </div>
                  {isActive && (
                    <span className="ml-auto text-sm text-blue-500 font-medium animate-pulse">
                      Processing...
                    </span>
                  )}
                  {isError && (
                    <div className="ml-auto flex flex-col items-end">
                      <span className="text-sm text-destructive font-medium">
                        Error occurred
                      </span>
                      {status?.error && (
                        <span className="text-xs text-muted-foreground mt-1">
                          {status.error}
                        </span>
                      )}
                    </div>
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